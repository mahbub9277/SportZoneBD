import cron from 'node-cron'
import { prisma } from '../core/prisma.js'
import logger from '../core/logger.js'
import { validateProxyTargetUrl } from '../utils/ssrfGuard.js'
import { emitAutomationStatusUpdate, emitAutomationMetricsUpdate, emitAutomationLogEntry, emitAdminResourceUpdated } from '../core/socketManager.js'
import { notifyMatchStarted, notifyMatchReminder } from './notification.service.js'
import { cleanupMatch } from './match-cleanup.service.js'
import { prewarmUpcomingMatches, cleanupCloudinaryOrphans } from './automation-support.service.js'
import { isRedisConfigured, redis } from '../core/redis.js'
import { cache, invalidateTags } from '../core/cache.js'
import { emitMatchStatusUpdated } from '../core/socketManager.js'
import { getRedisErrorCode } from '../core/redisFailover.js'
import { getCompetitionFixtures, getConfiguredCompetitionCodes, getConfiguredCompetitionFixtures, type FootballDataFixture } from '../modules/matches/footballDataMatches.service.js'

const DISCOVERY_DAYS = 2
const RECENT_MATCH_RETENTION_MINUTES = 7 * 24 * 60
const PRE_MATCH_HEALTH_WINDOW_MINUTES = Number(process.env.PRE_MATCH_HEALTH_WINDOW_MINUTES ?? 90)
const STREAM_HEALTH_TIMEOUT_MS = Number(process.env.STREAM_HEALTH_TIMEOUT_MS ?? 8000)
const FINISHED_MATCH_RETENTION_MINUTES = Math.max(RECENT_MATCH_RETENTION_MINUTES, Number(process.env.FINISHED_MATCH_RETENTION_MINUTES ?? RECENT_MATCH_RETENTION_MINUTES))
const FINISHED_MATCH_CLEANUP_BATCH_SIZE = 25
const STREAM_HEALTH_FAILURE_THRESHOLD = Number(process.env.STREAM_HEALTH_FAILURE_THRESHOLD ?? 3)
const STREAM_HEALTH_CHECK_INTERVAL_MINUTES = 2
const AUTOMATION_LOCK_TTL_SECONDS = 55
const STREAM_HEALTH_MAX_BYTES = 64 * 1024

async function readHealthResponsePrefix(response: Response, maxBytes: number): Promise<{ text: string; bytesRead: number }> {
  if (!response.body) return { text: '', bytesRead: 0 }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read()
      if (done || !value) break
      const remaining = maxBytes - total
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value
      chunks.push(chunk)
      total += chunk.byteLength
      if (total >= maxBytes) break
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  return {
    text: new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))),
    bytesRead: total,
  }
}

function normalizeTeamName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\b(?:fc|cf|sc|ac|afc|cfc)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function normalizeProviderMatchStatus(status: string): 'UPCOMING' | 'LIVE' | 'FINISHED' | null {
  switch (status) {
    case 'SCHEDULED':
    case 'TIMED':
      return 'UPCOMING'
    case 'IN_PLAY':
    case 'PAUSED':
      return 'LIVE'
    case 'FINISHED':
    case 'AWARDED':
      return 'FINISHED'
    default:
      return null
  }
}

function normalizeApprovedMatchTitle(home: string, away: string): string {
  return `${normalizeTeamName(home)} vs ${normalizeTeamName(away)}`
}

function isInCloseKickoffWindow(candidate: Date, target: Date, maxDeltaMs: number): boolean {
  return Math.abs(candidate.getTime() - target.getTime()) <= maxDeltaMs
}

function getFixtureIdentityKey(fixture: Pick<FootballDataFixture, 'competitionCode' | 'competitionName' | 'homeTeamName' | 'awayTeamName' | 'kickoffAt'>): string {
  const kickoffAt = new Date(fixture.kickoffAt)
  const kickoffKey = Number.isNaN(kickoffAt.getTime()) ? fixture.kickoffAt : kickoffAt.toISOString()

  return [
    normalizeTeamName(fixture.competitionCode || fixture.competitionName),
    normalizeTeamName(fixture.homeTeamName),
    normalizeTeamName(fixture.awayTeamName),
    kickoffKey,
  ].join('|')
}

function createProviderFixtureKey(fixture: Pick<FootballDataFixture, 'id' | 'competitionCode' | 'competitionName' | 'homeTeamName' | 'awayTeamName' | 'kickoffAt'>): string {
  if (fixture.id?.trim()) return `football-data-org:${fixture.id.trim()}`
  const key = getFixtureIdentityKey(fixture)
  return `football-data-org:${key}`
}

function getMatchIdentityKey(match: {
  kickoffAt: Date | null
  tournamentName?: string | null
  homeTeamName?: string | null
  awayTeamName?: string | null
}): string | null {
  if (!match.kickoffAt) return null

  return [
    normalizeTeamName(match.tournamentName ?? ''),
    normalizeTeamName(match.homeTeamName ?? ''),
    normalizeTeamName(match.awayTeamName ?? ''),
    match.kickoffAt.toISOString(),
  ].join('|')
}

export interface MatchAutomationJobOptions {
  cronExpression?: string
}

export class MatchAutomationService {
  private readonly cronExpression: string
  private jobId: string | null = null
  private cronTask: ReturnType<typeof cron.schedule> | null = null
  private isStarted = false
  private isRunning = false
  private hasLoggedRedisLockUnavailable = false
  private hasLoggedFootballDataKeyUnavailable = false

  constructor(options: MatchAutomationJobOptions = {}) {
    this.cronExpression = options.cronExpression ?? '* * * * *'
  }

  private async ensureAutomationJob(): Promise<string> {
    let job = await prisma.automationJob.findFirst({
      where: { name: 'Match Automation Scheduler' },
    })

    if (!job) {
      job = await prisma.automationJob.create({
        data: {
          name: 'Match Automation Scheduler',
          status: 'IDLE',
          cronExpression: this.cronExpression,
          isEnabled: true,
        },
      })
    }

    this.jobId = job.id
    return job.id
  }

  async start(): Promise<void> {
    // Prevent duplicate registration if start() is called multiple times
    if (this.isStarted) {
      logger.warn('Match automation service already started. Ignoring duplicate start call.')
      return
    }

    this.cronTask = cron.schedule(this.cronExpression, async () => {
      try {
        if (this.isRunning) return
        await this.runAutomation()
      } catch (error) {
        logger.error({ error }, 'Match automation job failed')
      }
    }, process.env.APP_TIMEZONE ? { timezone: process.env.APP_TIMEZONE } : undefined)

    this.isStarted = true
    logger.info({ cronExpression: this.cronExpression }, 'Match automation service started')

    try {
      await this.ensureAutomationJob()
    } catch (error) {
      logger.warn({ error }, 'Match automation database initialization is unavailable; retrying on the next scheduled run')
    }
  }

  async stop(): Promise<void> {
    if (this.cronTask) {
      this.cronTask.stop()
      this.cronTask = null
      this.isStarted = false
      logger.info('Match automation service stopped')
    }
  }

  async runAutomation(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true
    const lockKey = 'sportzone:automation:match-lifecycle'
    const lockToken = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`
    let lockAcquired = false
    try {
      if (!isRedisConfigured) {
        if (!this.hasLoggedRedisLockUnavailable) {
          logger.warn('Match automation skipped because its Redis lock is not configured')
          this.hasLoggedRedisLockUnavailable = true
        }
        return
      }

      let lock: string | null
      try {
        lock = await redis.set(lockKey, lockToken, 'EX', AUTOMATION_LOCK_TTL_SECONDS, 'NX')
      } catch (error) {
        if (!this.hasLoggedRedisLockUnavailable) {
          logger.warn({ code: getRedisErrorCode(error) }, 'Match automation skipped because its Redis lock is unavailable')
          this.hasLoggedRedisLockUnavailable = true
        }
        return
      }
      this.hasLoggedRedisLockUnavailable = false
      lockAcquired = Boolean(lock)
      if (!lockAcquired) return

    if (!this.jobId) {
      await this.ensureAutomationJob()
    }

    const now = new Date()

    const matchesStarting = await prisma.match.findMany({
      where: {
        status: 'UPCOMING',
        kickoffAt: {
          lte: now,
        },
        deletedAt: null,
      },
      select: { id: true, title: true },
    })

    if (matchesStarting.length > 0) {
      await prisma.match.updateMany({
        where: { id: { in: matchesStarting.map((match) => match.id) }, status: 'UPCOMING' },
        data: { status: 'LIVE', startTime: now },
      })
      await invalidateTags(['matches', 'AdminStats'])
      for (const match of matchesStarting) {
        emitAdminResourceUpdated('Match', match.id, { status: 'LIVE' })
        emitMatchStatusUpdated({ id: match.id, status: 'LIVE' })
      }

      for (const match of matchesStarting) {
        try {
          const createdCount = await notifyMatchStarted(match)
          logger.info({ matchId: match.id, createdCount }, 'Match-start notifications broadcast')
        } catch (error) {
          logger.error({ error, matchId: match.id }, 'Match-start notification broadcast failed')
        }
      }
    }

    // A database query keeps the reminder authoritative across restarts and instances.
    // It also catches matches created inside the one-hour window without sending after kickoff.
    const reminderWindowEnd = new Date(now.getTime() + 60 * 60 * 1000)
    const reminderMatches = await prisma.match.findMany({
      where: {
        status: 'UPCOMING',
        deletedAt: null,
        kickoffAt: { gt: now, lte: reminderWindowEnd },
      },
      select: { id: true, title: true },
    })
    for (const match of reminderMatches) {
      try {
        const createdCount = await notifyMatchReminder(match)
        logger.info({ matchId: match.id, createdCount }, 'Match reminder notifications queued')
      } catch (error) {
        logger.warn({ err: error, matchId: match.id }, 'Match reminder notification failed')
      }
    }

    const matchesToFinish = await prisma.match.findMany({
      where: {
        status: 'LIVE',
        autoFinish: true,
        deletedAt: null,
        expectedEndTime: { lte: now },
      },
      select: { id: true },
    })

    if (matchesToFinish.length > 0) {
      const finishedMatchIds = matchesToFinish.map((match) => match.id)
      await prisma.$transaction([
        prisma.stream.updateMany({
          where: { matchId: { in: finishedMatchIds }, deletedAt: null },
          data: { enabled: false, status: 'OFFLINE', deletedAt: now },
        }),
        prisma.match.updateMany({
          where: { id: { in: finishedMatchIds }, status: 'LIVE' },
          data: { status: 'FINISHED', finishedAt: now },
        }),
      ])
      await invalidateTags(['matches', 'streams', 'AdminStats'])
      for (const matchId of finishedMatchIds) {
        emitAdminResourceUpdated('Match', matchId, { status: 'FINISHED', finishedAt: now })
        emitMatchStatusUpdated({ id: matchId, status: 'FINISHED', finishedAt: now })
      }
    }

    const cleanupCutoff = new Date(now.getTime() - FINISHED_MATCH_RETENTION_MINUTES * 60 * 1000)
    const expiredFinishedMatches = await prisma.match.findMany({
      where: {
        status: 'FINISHED',
        deletedAt: null,
        finishedAt: { lte: cleanupCutoff },
      },
      select: { id: true },
      orderBy: { finishedAt: 'asc' },
      take: FINISHED_MATCH_CLEANUP_BATCH_SIZE,
    })

    for (const match of expiredFinishedMatches) {
      try {
        await cleanupMatch(match.id, 'FINISHED_RETENTION_EXPIRED')
      } catch (error) {
        logger.error({ error, matchId: match.id }, 'Expired finished match cleanup failed')
      }
    }

    await this.syncProviderMatches()
    if (now.getMinutes() % STREAM_HEALTH_CHECK_INTERVAL_MINUTES === 0) {
      await this.syncApprovedStreamHealth()
    }
    await prewarmUpcomingMatches(now)

    const scheduleParts = new Intl.DateTimeFormat('en-US', {
      timeZone: process.env.APP_TIMEZONE || 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now)
    const schedulePart = (type: Intl.DateTimeFormatPartTypes) => scheduleParts.find((part) => part.type === type)?.value
    if (schedulePart('weekday') === 'Sun' && schedulePart('hour') === '03' && Number(schedulePart('minute')) === 0) {
      await cleanupCloudinaryOrphans()
    }

    // Emit metrics update after automation completes
    if (this.jobId) {
      const [totalRuns, successfulRuns, failedRuns] = await Promise.all([
        prisma.automationLog.count({ where: { jobId: this.jobId } }),
        prisma.automationLog.count({ where: { jobId: this.jobId, status: 'SUCCESS' } }),
        prisma.automationLog.count({ where: { jobId: this.jobId, status: 'FAILED' } }),
      ])

      const matchesCreatedLast24h = await prisma.automationLog.count({
        where: {
          jobId: this.jobId,
          action: 'DISCOVER_MATCHES',
          status: 'SUCCESS',
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      })

      const streamsValidatedLast24h = await prisma.automationLog.count({
        where: {
          jobId: this.jobId,
          action: 'VALIDATE_STREAMS',
          status: 'SUCCESS',
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      })

      const lastRun = await prisma.automationLog.findFirst({
        where: { jobId: this.jobId },
        orderBy: { createdAt: 'desc' },
      })

      const job = await prisma.automationJob.findUnique({ where: { id: this.jobId }, include: { logs: { take: 10, orderBy: { createdAt: 'desc' } } } })
      if (job) {
        emitAutomationStatusUpdate(job)
      }

      emitAutomationMetricsUpdate({
        totalRuns,
        successfulRuns,
        failedRuns,
        matchesCreatedLast24h,
        streamsValidatedLast24h,
        lastRunAt: lastRun?.createdAt,
        // Add missing properties
        jobStatus: job?.status ?? 'IDLE',
        isEnabled: job?.isEnabled ?? false,
      })
    }
    } finally {
      this.isRunning = false
      if (lockAcquired) {
        try {
          await redis.eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
            1,
            lockKey,
            lockToken,
          )
        } catch (error) {
          logger.warn({ code: getRedisErrorCode(error) }, 'Automation lock release failed')
        }
      }
    }
  }

  private async syncProviderMatches(): Promise<void> {
    if (!this.jobId) return
    if (!process.env.FOOTBALL_API_KEY?.trim()) {
      if (!this.hasLoggedFootballDataKeyUnavailable) {
        logger.warn({ environmentVariable: 'FOOTBALL_API_KEY', competitions: getConfiguredCompetitionCodes() }, 'Skipping football fixture sync because its provider key is not configured')
        this.hasLoggedFootballDataKeyUnavailable = true
      }
      return
    }
    this.hasLoggedFootballDataKeyUnavailable = false

    let createdCount = 0
    let updatedCount = 0
    let skippedCount = 0

    try {
      const from = new Date()
      const fromDate = from.toISOString().slice(0, 10)
      const to = new Date(`${fromDate}T00:00:00.000Z`)
      to.setUTCDate(to.getUTCDate() + DISCOVERY_DAYS)
      const toDate = to.toISOString().slice(0, 10)
      const fixtureWindowStart = new Date(`${fromDate}T00:00:00.000Z`)
      const fixtureWindowEndExclusive = new Date(to)
      fixtureWindowEndExclusive.setUTCDate(fixtureWindowEndExclusive.getUTCDate() + 1)
      const fixtures = await getConfiguredCompetitionFixtures(fromDate, toDate, async (competitionCode, requestFromDate, requestToDate) => {
        const cacheKey = `sportzone:football:fixtures:${competitionCode}:${requestFromDate}:${requestToDate}`
        return cache<FootballDataFixture[]>(cacheKey, () => getCompetitionFixtures(competitionCode, requestFromDate, requestToDate), 120)
      })

      const uniqueFixtures: FootballDataFixture[] = []
      const seenFixtureKeys = new Set<string>()
      for (const fixture of fixtures) {
        const fixtureKey = getFixtureIdentityKey(fixture)
        if (seenFixtureKeys.has(fixtureKey)) continue
        seenFixtureKeys.add(fixtureKey)
        uniqueFixtures.push(fixture)
      }

      const existingMatches = await prisma.match.findMany({
        where: {
          deletedAt: null,
          kickoffAt: {
            gte: fixtureWindowStart,
            lt: fixtureWindowEndExclusive,
          },
        },
        select: {
          id: true,
          title: true,
          kickoffAt: true,
          homeTeamName: true,
          awayTeamName: true,
          homeTeamId: true,
          awayTeamId: true,
          homeTeamLogo: true,
          awayTeamLogo: true,
          sport: true,
          status: true,
          finishedAt: true,
          tournamentName: true,
        },
      })

      const existingMatchLookup = new Map<string, (typeof existingMatches)[number]>()
      for (const match of existingMatches) {
        const lookupKey = getMatchIdentityKey(match)
        if (lookupKey) existingMatchLookup.set(lookupKey, match)
      }

      for (const fixture of uniqueFixtures) {
        const homeName = fixture.homeTeamName.trim()
        const awayName = fixture.awayTeamName.trim()
        const kickoffAt = new Date(fixture.kickoffAt)
        const providerStatus = normalizeProviderMatchStatus(fixture.status)

        if (!homeName || !awayName || Number.isNaN(kickoffAt.getTime()) || !providerStatus) {
          skippedCount++
          continue
        }

        const normalizedHome = normalizeTeamName(homeName)
        const normalizedAway = normalizeTeamName(awayName)
        const desiredTitle = normalizeApprovedMatchTitle(homeName, awayName)
        const matchWindow = 4 * 60 * 60 * 1000
        const existingMatch = existingMatchLookup.get(getFixtureIdentityKey(fixture)) ?? existingMatches.find((match) => {
          if (!match.kickoffAt) return false
          if (!isInCloseKickoffWindow(match.kickoffAt, kickoffAt, matchWindow)) return false

          const existingHome = normalizeTeamName(match.homeTeamName ?? match.title.split(' vs ')[0] ?? '')
          const existingAway = normalizeTeamName(match.awayTeamName ?? match.title.split(' vs ')[1] ?? '')
          return existingHome === normalizedHome && existingAway === normalizedAway
        })

        const homeTeam = await prisma.team.findFirst({ where: { deletedAt: null, normalizedName: normalizedHome } })
        const awayTeam = await prisma.team.findFirst({ where: { deletedAt: null, normalizedName: normalizedAway } })

        if (existingMatch) {
          const homeTeamId = homeTeam?.id ?? existingMatch.homeTeamId ?? null
          const awayTeamId = awayTeam?.id ?? existingMatch.awayTeamId ?? null
          const homeTeamLogo = homeTeam?.logoUrl?.trim() || existingMatch.homeTeamLogo?.trim() || fixture.homeTeamCrest || null
          const awayTeamLogo = awayTeam?.logoUrl?.trim() || existingMatch.awayTeamLogo?.trim() || fixture.awayTeamCrest || null
            const status = existingMatch.status === 'FINISHED'
              ? 'FINISHED'
              : existingMatch.status === 'LIVE' && providerStatus === 'UPCOMING'
                ? 'LIVE'
                : providerStatus
            const finishedAt = status === 'FINISHED' ? existingMatch.finishedAt ?? new Date() : null
          const needsUpdate =
            existingMatch.title !== `${homeName} vs ${awayName}` ||
            existingMatch.homeTeamName !== homeName ||
            existingMatch.awayTeamName !== awayName ||
            existingMatch.kickoffAt.getTime() !== kickoffAt.getTime() ||
            existingMatch.tournamentName !== fixture.competitionName ||
            existingMatch.homeTeamId !== homeTeamId ||
            existingMatch.awayTeamId !== awayTeamId ||
            existingMatch.homeTeamLogo !== homeTeamLogo ||
            existingMatch.awayTeamLogo !== awayTeamLogo ||
            existingMatch.sport !== 'FOOTBALL' ||
            existingMatch.status !== status ||
            (existingMatch.finishedAt?.getTime() ?? null) !== (finishedAt?.getTime() ?? null)

          if (needsUpdate) {
            await prisma.match.update({
              where: { id: existingMatch.id },
              data: {
                title: `${homeName} vs ${awayName}`,
                kickoffAt,
                homeTeamName: homeName,
                awayTeamName: awayName,
                homeTeamId,
                awayTeamId,
                homeTeamLogo,
                awayTeamLogo,
                sport: 'FOOTBALL',
                tournamentName: fixture.competitionName || existingMatch.tournamentName || null,
                status,
                finishedAt,
              },
            })
            updatedCount++
          }

          continue
        }

        const providerFixtureKey = createProviderFixtureKey(fixture)

        try {
          await prisma.match.create({
            data: {
              providerFixtureKey,
              title: `${homeName} vs ${awayName}`,
              kickoffAt,
              homeTeamName: homeName,
              awayTeamName: awayName,
              homeTeamId: homeTeam?.id ?? null,
              awayTeamId: awayTeam?.id ?? null,
              homeTeamLogo: homeTeam?.logoUrl?.trim() || fixture.homeTeamCrest || null,
              awayTeamLogo: awayTeam?.logoUrl?.trim() || fixture.awayTeamCrest || null,
              sport: 'FOOTBALL',
              tournamentName: fixture.competitionName,
              status: providerStatus,
              finishedAt: providerStatus === 'FINISHED' ? new Date() : null,
              premium: false,
              autoFinish: false,
              startTime: new Date(kickoffAt.getTime() - PRE_MATCH_HEALTH_WINDOW_MINUTES * 60 * 1000),
            },
          })
          createdCount++
          logger.info({ title: desiredTitle, kickoffAt }, 'Created new upcoming match from provider sync')
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
            skippedCount++
            logger.info({ title: desiredTitle, kickoffAt, providerFixtureKey }, 'Skip duplicate provider fixture already created')
            continue
          }
          throw error
        }
      }

      if (createdCount > 0 || updatedCount > 0) {
        await invalidateTags(['matches', 'AdminStats'])
      }

      const newLog = await prisma.automationLog.create({
        data: {
          jobId: this.jobId,
          action: 'DISCOVER_MATCHES',
          status: 'SUCCESS',
          summary: `Created ${createdCount}, updated ${updatedCount}, skipped ${skippedCount}`,
          details: { createdCount, updatedCount, skippedCount },
        },
      })
      emitAutomationLogEntry(newLog)
    } catch (error) {
      if (createdCount > 0 || updatedCount > 0) {
        await invalidateTags(['matches', 'AdminStats'])
      }
      logger.error({ error }, 'Provider match sync failed')
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      const newLog = await prisma.automationLog.create({
        data: {
          jobId: this.jobId,
          action: 'DISCOVER_MATCHES',
          status: 'FAILED',
          errorMessage,
        },
      })
      emitAutomationLogEntry(newLog)
    }
  }

  private async syncApprovedStreamHealth(): Promise<void> {
    if (!this.jobId) return

    let healthyCount = 0
    let offlineCount = 0
    let errorCount = 0
    let responsePrefixBytes = 0

    try {
      const matches = await prisma.match.findMany({
        where: {
          deletedAt: null,
          status: 'LIVE',
        },
        include: {
          streams: { where: { deletedAt: null } },
        },
      })

      const allowlistedDomains = await prisma.allowedDomain.findMany({
        where: { isEnabled: true },
        select: { host: true },
      })

      const allowedHosts = allowlistedDomains.map((domain) => domain.host)
      const requireAllowlist = allowedHosts.length > 0

      for (const match of matches) {
        if (!match.streams.length) {
          continue
        }

        for (const stream of match.streams) {
          const candidateUrls = [...new Set([stream.primaryUrl, stream.backupUrl].filter((value): value is string => Boolean(value?.trim())))]

          let nextStatus: 'READY' | 'LIVE' | 'OFFLINE' | 'ERROR' = 'OFFLINE'
          let isHealthy = false

          for (const [candidateIndex, candidateUrl] of candidateUrls.entries()) {
            try {
              const validated = await validateProxyTargetUrl(candidateUrl, {
                allowedDomains: allowedHosts,
                requireAllowlist,
              })

              const response = await fetch(validated.url.toString(), {
                method: 'GET',
                headers: {
                  Accept: 'application/vnd.apple.mpegurl,text/plain,application/x-mpegURL,*/*',
                  Range: `bytes=0-${STREAM_HEALTH_MAX_BYTES - 1}`,
                  'User-Agent': 'SportZoneAutomation/1.0',
                },
                signal: AbortSignal.timeout(STREAM_HEALTH_TIMEOUT_MS),
              })

              const contentType = response.headers.get('content-type') ?? ''
              const body = await readHealthResponsePrefix(response, STREAM_HEALTH_MAX_BYTES)
              responsePrefixBytes += body.bytesRead
              const looksLikeHls = response.ok && (contentType.includes('mpegurl') || body.text.includes('#EXTM3U'))

              if (looksLikeHls) {
                isHealthy = true
                nextStatus = match.status === 'LIVE' ? 'LIVE' : 'READY'
                if (candidateIndex > 0) {
                  logger.warn({ matchId: match.id, streamId: stream.id }, 'Stream health check validated backup fallback')
                }
                healthyCount++
                break
              }
            } catch (error) {
              logger.warn({ streamId: stream.id, candidateUrl, error }, 'Approved stream health check failed')
            }
          }

          const failureKey = `sportzone:stream-health-failures:${stream.id}`
          const alreadyInErrorState = stream.status === 'ERROR'

          if (!isHealthy) {
            if (!alreadyInErrorState) {
              const failures = Number(await redis.incr(failureKey))
              await redis.expire(failureKey, 15 * 60)
              if (failures < STREAM_HEALTH_FAILURE_THRESHOLD) {
                logger.warn({ streamId: stream.id, failures }, 'Transient stream health failure retained')
                continue
              }
              nextStatus = 'ERROR'
              errorCount++
            } else {
              nextStatus = 'ERROR'
            }
          } else if (nextStatus === 'OFFLINE') {
            offlineCount++
          } else {
            await redis.del(failureKey)
          }

          if (nextStatus === 'ERROR' && alreadyInErrorState && stream.enabled === false) {
            continue
          }

          await prisma.stream.update({
            where: { id: stream.id },
            data: {
              status: nextStatus,
              enabled: isHealthy ? true : false,
            },
          })
        }
      }

      const newLog = await prisma.automationLog.create({
        data: {
          jobId: this.jobId,
          action: 'VALIDATE_STREAMS',
          status: 'SUCCESS',
          summary: `Checked streams: ${healthyCount} healthy, ${offlineCount} offline, ${errorCount} errors; read ${responsePrefixBytes} upstream response bytes`,
          details: { healthyCount, offlineCount, errorCount, responsePrefixBytes },
        },
      })
      emitAutomationLogEntry(newLog)
    } catch (error) {
      logger.error({ error }, 'Stream health sync failed')
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      const newLog = await prisma.automationLog.create({
        data: {
          jobId: this.jobId,
          action: 'VALIDATE_STREAMS',
          status: 'FAILED',
          errorMessage,
        },
      })
      emitAutomationLogEntry(newLog)
    }
  }
}

export const matchAutomationService = new MatchAutomationService()
