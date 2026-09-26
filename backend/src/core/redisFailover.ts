export interface RedisFailoverProvider<Client> {
  name: string
  client: Client
  configured: boolean
}

interface FailoverLogger {
  info(fields: Record<string, unknown>, message: string): void
  warn(fields: Record<string, unknown>, message: string): void
  error(fields: Record<string, unknown>, message: string): void
}

interface RedisFailoverOptions<Client> {
  providers: RedisFailoverProvider<Client>[]
  logger: FailoverLogger
  failureThreshold?: number
  cooldownMs?: number
  commandTimeoutMs?: number
  recoverySuccessThreshold?: number
  recoveryIntervalMs?: number
}

type PingableClient = { ping(): Promise<unknown> }

export function getRedisErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code.slice(0, 64) : undefined
}

function isRedisProviderFailure(error: unknown): boolean {
  const code = getRedisErrorCode(error)
  if (code && /^(ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|EPIPE|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN)$/i.test(code)) {
    return true
  }

  const message = error instanceof Error ? error.message : String(error)
  return /(connection (?:closed|lost|refused|reset)|timed? ?out|timeout|quota|rate.?limit|too many (?:requests|commands)|(?:requests?|commands?)\s+per\s+(?:second|minute|day)|max(?:imum)?\s+(?:daily\s+)?(?:requests?|commands?)|limit (?:reached|exceeded)|request limit|temporarily unavailable|provider unavailable|command limit|\boom\b)/i.test(message)
}

export class RedisFailoverManager<Client extends PingableClient> {
  private readonly providers: RedisFailoverProvider<Client>[]
  private readonly logger: FailoverLogger
  private readonly failureThreshold: number
  private readonly cooldownMs: number
  private readonly commandTimeoutMs: number
  private readonly recoverySuccessThreshold: number
  private readonly recoveryIntervalMs: number
  private readonly failureCounts = new Map<number, number>()
  private readonly cooldownUntil = new Map<number, number>()
  private readonly recoverySuccesses = new Map<number, number>()
  private activeIndex: number
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null
  private recoveryCheck: Promise<void> | null = null
  private transition: Promise<void> | null = null
  private allUnavailableLogged = false
  private stopped = false

  constructor(options: RedisFailoverOptions<Client>) {
    this.providers = options.providers
    this.logger = options.logger
    this.failureThreshold = options.failureThreshold ?? 3
    this.cooldownMs = options.cooldownMs ?? 30_000
    this.commandTimeoutMs = options.commandTimeoutMs ?? 5_000
    this.recoverySuccessThreshold = options.recoverySuccessThreshold ?? 3
    this.recoveryIntervalMs = options.recoveryIntervalMs ?? 30_000

    const firstConfigured = this.providers.findIndex((provider) => provider.configured)
    this.activeIndex = firstConfigured >= 0 ? firstConfigured : 0
    if (this.activeIndex > 0) this.scheduleRecoveryCheck()
  }

  get activeProvider(): string | null {
    return this.providers[this.activeIndex]?.configured ? this.providers[this.activeIndex].name : null
  }

  async execute<Result>(operation: (client: Client) => Promise<Result>): Promise<Result> {
    const providerIndex = this.activeIndex
    if (providerIndex < 0 && this.providers.some((provider) => provider.configured)) {
      throw new Error('All configured Redis providers are unavailable')
    }
    const provider = this.providers[providerIndex]
    if (!provider) throw new Error('No Redis provider is configured')

    try {
      const result = await this.withTimeout(operation(provider.client))
      if (this.activeIndex === providerIndex) this.failureCounts.set(providerIndex, 0)
      return result
    } catch (error) {
      if (isRedisProviderFailure(error)) await this.recordFailure(providerIndex, error)
      throw error
    }
  }

  async checkForRecovery(): Promise<void> {
    if (this.recoveryCheck) return this.recoveryCheck
    this.recoveryCheck = this.performRecoveryCheck()
    try {
      await this.recoveryCheck
    } finally {
      this.recoveryCheck = null
    }
  }

  stop(): void {
    this.stopped = true
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer)
    this.recoveryTimer = null
  }

  private async withTimeout<Result>(operation: Promise<Result>): Promise<Result> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        operation,
        new Promise<Result>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Redis command timed out')), this.commandTimeoutMs)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private async probe(providerIndex: number): Promise<boolean> {
    const provider = this.providers[providerIndex]
    if (!provider?.configured) return false
    try {
      await this.withTimeout(Promise.resolve(provider.client.ping()))
      return true
    } catch {
      this.cooldownUntil.set(providerIndex, Date.now() + this.cooldownMs)
      this.recoverySuccesses.set(providerIndex, 0)
      return false
    }
  }

  private async recordFailure(providerIndex: number, error: unknown): Promise<void> {
    if (!this.providers[providerIndex]?.configured || this.activeIndex !== providerIndex) return
    const failures = (this.failureCounts.get(providerIndex) ?? 0) + 1
    this.failureCounts.set(providerIndex, failures)
    if (failures < this.failureThreshold) return

    const provider = this.providers[providerIndex]
    this.failureCounts.set(providerIndex, 0)
    this.cooldownUntil.set(providerIndex, Date.now() + this.cooldownMs)
    this.logger.warn({ provider: provider.name, failureThreshold: this.failureThreshold, code: getRedisErrorCode(error) }, 'Redis provider circuit opened')
    this.logger.warn({ provider: provider.name }, 'Redis failover attempt started')

    if (!this.transition) this.transition = this.selectHealthyProvider(providerIndex)
    try {
      await this.transition
    } finally {
      this.transition = null
    }
  }

  private async selectHealthyProvider(failedIndex: number): Promise<void> {
    const candidateIndexes = this.providers
      .map((_provider, index) => index)
      .filter((index) => index !== failedIndex && this.providers[index].configured)
      .sort((left, right) => left - right)

    for (const candidateIndex of candidateIndexes) {
      if ((this.cooldownUntil.get(candidateIndex) ?? 0) > Date.now()) continue
      if (await this.probe(candidateIndex)) {
        if (candidateIndex < failedIndex) {
          const successes = (this.recoverySuccesses.get(candidateIndex) ?? 0) + 1
          this.recoverySuccesses.set(candidateIndex, successes)
          if (successes < this.recoverySuccessThreshold) continue
        }
        const previousProvider = this.providers[failedIndex].name
        this.activeIndex = candidateIndex
        this.allUnavailableLogged = false
        this.recoverySuccesses.clear()
        this.logger.warn({ fromProvider: previousProvider, toProvider: this.providers[candidateIndex].name }, 'Redis active provider changed')
        this.scheduleRecoveryCheck()
        return
      }
    }

    this.activeIndex = -1
    if (!this.allUnavailableLogged) {
      this.logger.error({ providerCount: this.providers.filter((provider) => provider.configured).length }, 'All configured Redis providers are unavailable')
      this.allUnavailableLogged = true
    }
    this.scheduleRecoveryCheck()
  }

  private async performRecoveryCheck(): Promise<void> {
    const activeIndex = this.activeIndex
    const candidateIndexes = this.providers
      .map((_provider, index) => index)
      .filter((index) => this.providers[index].configured && (activeIndex < 0 || index < activeIndex))

    for (const candidateIndex of candidateIndexes) {
      if ((this.cooldownUntil.get(candidateIndex) ?? 0) > Date.now()) continue
      if (await this.probe(candidateIndex)) {
        const successes = (this.recoverySuccesses.get(candidateIndex) ?? 0) + 1
        this.recoverySuccesses.set(candidateIndex, successes)
        if (successes >= this.recoverySuccessThreshold && this.activeIndex === activeIndex) {
          const previousProvider = this.providers[activeIndex]?.name ?? null
          this.activeIndex = candidateIndex
          this.allUnavailableLogged = false
          this.recoverySuccesses.clear()
          this.logger.info({ fromProvider: previousProvider, toProvider: this.providers[candidateIndex].name }, 'Redis provider recovery completed')
        }
        return
      }
    }
  }

  private scheduleRecoveryCheck(): void {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer)
    if (this.stopped || this.activeIndex === 0 || !this.providers.some((provider) => provider.configured)) return

    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null
      void this.checkForRecovery().finally(() => this.scheduleRecoveryCheck())
    }, this.recoveryIntervalMs)
    this.recoveryTimer.unref?.()
  }
}