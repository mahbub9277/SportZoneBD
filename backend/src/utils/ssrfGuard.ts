import dns from 'node:dns/promises'
import net from 'node:net'
import type { LookupFunction } from 'node:net'

const forbiddenProtocols = new Set(['ftp', 'file', 'gopher'])
const loopbackHostnames = new Set(['localhost', 'localhost.localdomain', 'localhost6', 'ip6-localhost', 'local'])
const localhostSuffixes = ['.localhost', '.local', '.internal']

const ipv4PrivateRanges = [
  { start: '0.0.0.0', end: '0.255.255.255' },
  { start: '10.0.0.0', end: '10.255.255.255' },
  { start: '100.64.0.0', end: '100.127.255.255' },
  { start: '127.0.0.0', end: '127.255.255.255' },
  { start: '169.254.0.0', end: '169.254.255.255' },
  { start: '172.16.0.0', end: '172.31.255.255' },
  { start: '192.0.0.0', end: '192.0.0.255' },
  { start: '192.0.2.0', end: '192.0.2.255' },
  { start: '192.88.99.0', end: '192.88.99.255' },
  { start: '192.168.0.0', end: '192.168.255.255' },
  { start: '198.18.0.0', end: '198.19.255.255' },
  { start: '198.51.100.0', end: '198.51.100.255' },
  { start: '203.0.113.0', end: '203.0.113.255' },
  { start: '224.0.0.0', end: '255.255.255.255' },
]

const ipv6PrivateRanges = [
  { start: '::', end: '::' },
  { start: '::1', end: '::1' },
  { start: 'fc00::', end: 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff' },
  { start: 'fe80::', end: 'febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff' },
  { start: 'ff00::', end: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff' },
  { start: '2001:db8::', end: '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff' },
]

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
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
  return address.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0
}

function ipv6ToBigInt(address: string): bigint {
  const normalized = address.toLowerCase().replace(/(\d+\.\d+\.\d+\.\d+)$/, (ipv4) => {
    const value = BigInt(ipv4ToLong(ipv4))
    return `${Number((value >> 16n) & 0xffffn).toString(16)}:${Number(value & 0xffffn).toString(16)}`
  })
  const [left = '', right] = normalized.split('::')
  const leftParts = left ? left.split(':') : []
  const rightParts = right ? right.split(':') : []
  const zeroCount = Math.max(0, 8 - leftParts.length - rightParts.length)
  const expanded = [...leftParts, ...Array(zeroCount).fill('0'), ...rightParts]

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
    const value = ipv6ToBigInt(address)
    if (value >> 32n === 0xffffn) {
      const mappedIpv4 = Number(value & 0xffffffffn)
      const mappedAddress = [24, 16, 8, 0].map((shift) => (mappedIpv4 >>> shift) & 0xff).join('.')
      return isPrivateOrLocalAddress(mappedAddress)
    }
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
    resolveHostname?: (hostname: string) => Promise<string[]>
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

  if (options.requireAllowlist && (allowedHosts.length === 0 || !isAllowedByDomain)) {
    throw new Error(allowedHosts.length === 0 ? 'Proxy allowlist is required' : 'Host is not allowlisted')
  }

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

    if (trustedUrls.length > 0 && !isTrustedUrl) {
      throw new Error('Target URL is not registered for the requested stream')
    }

    return {
      url: parsed,
      resolvedAddresses: [hostname],
    }
  }

  const resolvedIpAddresses = options.resolveHostname
    ? await options.resolveHostname(hostname)
    : (await dns.lookup(hostname, { all: true })).map((entry) => entry.address)

  if (resolvedIpAddresses.length === 0) {
    throw new Error('Target host did not resolve to an address')
  }

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

  if (trustedUrls.length > 0 && !isTrustedUrl) {
    throw new Error('Target URL is not registered for the requested stream')
  }

  return {
    url: parsed,
    resolvedAddresses: resolvedIpAddresses,
  }
}

export function createPinnedLookup(target: ValidatedTargetUrl): LookupFunction {
  const expectedHostname = normalizeHostname(target.url.hostname)
  const addresses = target.resolvedAddresses.map((address) => ({ address, family: net.isIP(address) }))

  return (hostname, options, callback) => {
    if (normalizeHostname(hostname) !== expectedHostname || addresses.length === 0) {
      callback(Object.assign(new Error('Pinned DNS lookup does not match the validated target'), { code: 'ENOTFOUND' }), '', 0)
      return
    }

    if (typeof options === 'object' && options.all) {
      callback(null, addresses)
      return
    }

    const requestedFamily = typeof options === 'number' ? options : options.family
    const selectedAddress = addresses.find(({ family }) => !requestedFamily || !family || family === requestedFamily)
    if (!selectedAddress) {
      callback(Object.assign(new Error('No validated address matches the requested family'), { code: 'ENOTFOUND' }), '', 0)
      return
    }

    callback(null, selectedAddress.address, selectedAddress.family)
  }
}

export async function validateProxyRedirect(
  location: string,
  baseUrl: URL,
  options: Parameters<typeof validateProxyTargetUrl>[1] = {},
  requireHttps = false,
): Promise<ValidatedTargetUrl> {
  let redirectUrl: URL
  try {
    redirectUrl = new URL(location, baseUrl)
  } catch {
    throw new Error('Redirect URL is invalid')
  }

  const validated = await validateProxyTargetUrl(redirectUrl.toString(), options)
  if (requireHttps && validated.url.protocol !== 'https:') {
    throw new Error('Only HTTPS proxy targets are allowed')
  }
  return validated
}

