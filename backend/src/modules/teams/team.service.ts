import { prisma } from '../../core/prisma.js'
import { normalizeTeamName } from './teamName.js'
import { assignedTeamLogoFields } from './teamLogo.js'

export { normalizeTeamName }

const toTeamResult = (team: { id: string; name: string; normalizedName: string; logoUrl: string | null; logoPublicId: string | null }) => ({
  id: team.id,
  name: team.name,
  normalizedName: team.normalizedName,
  logoUrl: team.logoUrl,
  logoPublicId: team.logoPublicId,
})

export async function searchTeams(query: string) {
  const normalizedQuery = normalizeTeamName(query)
  if (!normalizedQuery) return []

  const teams = await prisma.team.findMany({
    where: {
      deletedAt: null,
      normalizedName: { contains: normalizedQuery },
    },
    orderBy: { name: 'asc' },
    take: 10,
  })

  if (teams.length > 0) return teams.map(toTeamResult)

  const legacyMatches = await prisma.match.findMany({
    where: {
      deletedAt: null,
      // Team suggestions must not surface a fixture that is still awaiting review.
      status: { notIn: ['PENDING', 'REJECTED'] },
      OR: [
        { homeTeamName: { contains: normalizedQuery, mode: 'insensitive' } },
        { awayTeamName: { contains: normalizedQuery, mode: 'insensitive' } },
      ],
    },
    select: { homeTeamName: true, awayTeamName: true, homeTeamLogo: true, awayTeamLogo: true },
    take: 20,
  })

  const legacyCandidates = new Map<string, { name: string; logoUrl: string | null }>()
  for (const match of legacyMatches) {
    for (const candidate of [
      { name: match.homeTeamName, logoUrl: match.homeTeamLogo },
      { name: match.awayTeamName, logoUrl: match.awayTeamLogo },
    ]) {
      const name = candidate.name
      if (!name) continue
      const normalizedName = normalizeTeamName(name)
      if (normalizedName.includes(normalizedQuery) && !legacyCandidates.has(normalizedName)) legacyCandidates.set(normalizedName, { name, logoUrl: candidate.logoUrl })
    }
  }

  return [...legacyCandidates.entries()].slice(0, 10).map(([normalizedName, candidate]) => ({
    id: null,
    name: candidate.name.trim().replace(/\s+/g, ' '),
    normalizedName,
    logoUrl: candidate.logoUrl,
    logoPublicId: candidate.logoUrl,
  }))
}

export async function resolveTeam(input: { id?: string | null; name?: string | null; logoUrl?: string | null }) {
  const name = input.name?.trim().replace(/\s+/g, ' ')
  if (!name) return null
  const normalizedName = normalizeTeamName(name)

  if (input.id) {
    const existing = await prisma.team.findFirst({ where: { id: input.id, deletedAt: null } })
    if (existing) return existing
  }

  // A provider crest is never stored on a team record: `logoUrl`/`logoPublicId` hold the project's own
  // assets, and provider branding belongs to the match row that carries the fixture (see `teamLogo.ts`).
  const logoFields = assignedTeamLogoFields(input.logoUrl)

  try {
    return await prisma.team.upsert({
      where: { normalizedName },
      update: {
        name,
        ...logoFields,
        deletedAt: null,
      },
      create: {
        name,
        normalizedName,
        logoUrl: logoFields.logoUrl ?? null,
        logoPublicId: logoFields.logoPublicId ?? null,
      },
    })
  } catch (error) {
    const existing = await prisma.team.findUnique({ where: { normalizedName } })
    if (existing) return existing
    throw error
  }
}
