import dns from 'node:dns/promises'
import net from 'node:net'

const forbiddenProtocols = new Set(['ftp', 'file', 'gopher'])
const loopbackHostnames = new Set(['localhost', 'localhost.localdomain', 'localhost6', 'ip6-localhost', 'local'])
const localhostSuffixes = ['.localhost', '.local', '.internal']

const ipv4PrivateRanges = [
  { start: '10.0.0.0', end: '10.255.255.255' },
  { start: '127.0.0.0', end: '127.255.255.255' },
  { start: '169.254.0.0', end: '169.254.255.255' },
  { start: '172.16.0.0', end: '172.31.255.255' },
  { start: '192.168.0.0', end: '192.168.255.255' },
]

const ipv6PrivateRanges = [
  { start: '::1', end: '::1' },
  { start: 'fc00::', end: 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff' },
  { start: 'fe80::', end: 'febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff' },
]

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '')
}

function isLocalHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname)
  if (!normalized || loopbackHostnames.has(normalized)) return true
  if (normalized === '0.0.0.0' || normalized === '::' || normalized === '::1') return true
  if (normalized.startsWith('127.') || normalized.startsWith('10.') || normalized.startsWith('169.254.')) return true
  if (normalized.startsWith('172.16.') || normalized.startsWith('172.17.') || normalized.startsWith('172.18.') || normalized.startsWith('172.19.') || normalized.startsWith('172.20.') || normalized.startsWith('172.21.') || normalized.startsWith('172.22.') || normalized.startsWith('172.23.') || normalized.startsWith('172.24.') || normalized.startsWith('172.25.') || normalized.startsWith('172.26.') || normalized.startsWith('172.27.') || normalized.startsWith('172.28.') || normalized.startsWith('172.29.') || normalized.startsWith('172.30.') || normalized.startsWith('172.31.')) return true
  if (normalized.startsWith('192.168.')) return true
  return localhostSuffixes.some((suffix) => normalized.endsWith(suffix))
}

function normalizeUrl(value: string): string {
  try {
    const parsed = new URL(value)
    const protocol = parsed.protocol.toLowerCase()
    const hostname = normalizeHostname(parsed.hostname)
    const port = parsed.port && !((protocol === 'http:' && parsed.port === '80') || (protocol === 'https:' && parsed.port === '443'))
      ? `:${parsed.port}`
      : ''
    const pathname = parsed.pathname.replace(/\/+$|\\/g, '') || '/'
    const search = parsed.search
    return `${protocol}//${hostname}${port}${pathname}${search}`
  } catch {
    return value.trim()
  }
}

function ipv4ToLong(address: string): number {
  return address.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0)
}

function ipv6ToBigInt(address: string): bigint {
  const normalized = address.includes(':') ? address : address
  const parts = normalized.split(':')
  const expanded: string[] = []
  let missing = 8 - parts.length

  for (const part of parts) {
    if (part === '') {
      expanded.push(...Array(missing).fill('0'))
      missing = 0
    } else {
      expanded.push(part.padStart(4, '0'))
    }
  }

  if (expanded.length < 8) {
    expanded.push(...Array(8 - expanded.length).fill('0'))
  }

  let value = 0n
  for (const part of expanded) {
    value = (value << 16n) + BigInt(parseInt(part, 16))
  }
  return value
}

function isAddressInRange(address: string, start: string, end: string): boolean {
  if (net.isIP(address) === 4) {
    const addressValue = ipv4ToLong(address)
    return addressValue >= ipv4ToLong(start) && addressValue <= ipv4ToLong(end)
  }

  if (net.isIP(address) === 6) {
    const addressValue = ipv6ToBigInt(address)
    return addressValue >= ipv6ToBigInt(start) && addressValue <= ipv6ToBigInt(end)
  }

  return false
}

function isPrivateOrLocalAddress(address: string): boolean {
  if (net.isIP(address) === 4) {
    return ipv4PrivateRanges.some(({ start, end }) => isAddressInRange(address, start, end))
  }

  if (net.isIP(address) === 6) {
    return ipv6PrivateRanges.some(({ start, end }) => isAddressInRange(address, start, end))
  }

  return false
}

export interface ValidatedTargetUrl {
  url: URL
  resolvedAddresses: string[]
}

export async function validateProxyTargetUrl(
  targetUrl: string,
  options: {
    trustedUrls?: string[]
    allowedDomains?: string[]
    requireAllowlist?: boolean
  } = {},
): Promise<ValidatedTargetUrl> {
  let parsed: URL
  try {
    parsed = new URL(targetUrl)
  } catch {
    throw new Error('Target URL is invalid')
  }

  if (forbiddenProtocols.has(parsed.protocol.replace(':', ''))) {
    throw new Error('Unsupported protocol')
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https are supported')
  }

  if (parsed.username || parsed.password) {
    throw new Error('Embedded credentials are not allowed')
  }

  const hostname = normalizeHostname(parsed.hostname)
  if (!hostname || isLocalHostname(hostname)) {
    throw new Error('Loopback or local hosts are not allowed')
  }

  if (hostname === '169.254.169.254') {
    throw new Error('Metadata endpoints are not allowed')
  }

  const trustedUrls = (options.trustedUrls ?? []).map(normalizeUrl)
  const normalizedTargetUrl = normalizeUrl(parsed.toString())
  const isTrustedUrl = trustedUrls.length > 0 && trustedUrls.includes(normalizedTargetUrl)
  const allowedHosts = (options.allowedDomains ?? []).map((domain) => normalizeHostname(domain))
  const isAllowedByDomain = allowedHosts.some((domain) => domain === hostname || hostname.endsWith(`.${domain}`))

  if (net.isIP(hostname) === 4 || net.isIP(hostname) === 6) {
    if (isPrivateOrLocalAddress(hostname)) {
      throw new Error('Private or local IP addresses are not allowed')
    }

    if (isTrustedUrl) {
      return {
        url: parsed,
        resolvedAddresses: [hostname],
      }
    }

    if (options.requireAllowlist && allowedHosts.length > 0 && !isAllowedByDomain) {
      throw new Error('Host is not allowlisted')
    }

    if (trustedUrls.length > 0 && !isTrustedUrl) {
      throw new Error('Target URL is not registered for the requested stream')
    }

    return {
      url: parsed,
      resolvedAddresses: [hostname],
    }
  }

  const resolvedAddresses = await dns.lookup(hostname, { all: true })
  const resolvedIpAddresses = resolvedAddresses.map((entry) => entry.address)

  for (const address of resolvedIpAddresses) {
    if (isPrivateOrLocalAddress(address)) {
      throw new Error('Resolved address is private or local')
    }
  }

  if (isTrustedUrl) {
    return {
      url: parsed,
      resolvedAddresses: resolvedIpAddresses,
    }
  }

  if (options.requireAllowlist && allowedHosts.length > 0 && !isAllowedByDomain) {
    throw new Error('Host is not allowlisted')
  }

  if (trustedUrls.length > 0 && !isTrustedUrl) {
    throw new Error('Target URL is not registered for the requested stream')
  }

  return {
    url: parsed,
    resolvedAddresses: resolvedIpAddresses,
  }
}

