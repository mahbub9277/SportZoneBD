import assert from 'node:assert/strict'
import test from 'node:test'
import { createPinnedLookup, validateProxyRedirect, validateProxyTargetUrl } from './ssrfGuard.js'

const allowlist = ['example.com']
const resolvePublicHost = async () => ['8.8.8.8']

test('rejects local, private, mapped, and obfuscated IP targets', async () => {
  const targets = [
    'http://localhost/',
    'http://127.0.0.1/',
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://192.168.1.1/',
    'http://169.254.169.254/',
    'http://[::1]/',
    'http://[fc00::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0177.0.0.1/',
  ]

  for (const target of targets) {
    await assert.rejects(validateProxyTargetUrl(target), Error, target)
  }
})

test('requires a non-empty allowlist and rejects unapproved hosts', async () => {
  await assert.rejects(
    validateProxyTargetUrl('https://example.com/live.m3u8', { requireAllowlist: true }),
    /allowlist is required/,
  )
  await assert.rejects(
    validateProxyTargetUrl('https://notexample.com/live.m3u8', { allowedDomains: allowlist, requireAllowlist: true, resolveHostname: resolvePublicHost }),
    /not allowlisted/,
  )
  await validateProxyTargetUrl('https://cdn.example.com/live.m3u8', {
    allowedDomains: allowlist,
    requireAllowlist: true,
    resolveHostname: resolvePublicHost,
  })
})

test('rejects public hostnames resolving to private addresses', async () => {
  await assert.rejects(
    validateProxyTargetUrl('https://cdn.example.com/live.m3u8', {
      allowedDomains: allowlist,
      requireAllowlist: true,
      resolveHostname: async () => ['8.8.8.8', '10.0.0.2'],
    }),
    /Resolved address is private or local/,
  )
})

test('rejects unsupported protocols and embedded URL credentials', async () => {
  for (const target of ['file:///etc/passwd', 'ftp://example.com/live', 'gopher://example.com/', 'https://user:pass@example.com/live.m3u8']) {
    await assert.rejects(validateProxyTargetUrl(target), Error, target)
  }
})

test('revalidates redirects and requires HTTPS when requested', async () => {
  const baseUrl = new URL('https://cdn.example.com/master.m3u8')
  const validationOptions = {
    allowedDomains: allowlist,
    requireAllowlist: true,
    resolveHostname: resolvePublicHost,
  }

  await assert.rejects(
    validateProxyRedirect('http://127.0.0.1/private.m3u8', baseUrl, validationOptions, true),
    /local hosts are not allowed/,
  )
  await assert.rejects(
    validateProxyRedirect('http://cdn.example.com/redirect.m3u8', baseUrl, validationOptions, true),
    /Only HTTPS/,
  )
})

test('pins the request lookup to the already validated address', async () => {
  const validated = await validateProxyTargetUrl('https://cdn.example.com/live.m3u8', {
    allowedDomains: allowlist,
    requireAllowlist: true,
    resolveHostname: resolvePublicHost,
  })
  const lookup = createPinnedLookup(validated)

  const result = await new Promise<{ address: string; family: number }>((resolve, reject) => {
    lookup('cdn.example.com', {}, (error, address, family) => {
      if (error || typeof address !== 'string') {
        reject(error ?? new Error('Expected a pinned address'))
        return
      }
      resolve({ address, family: family ?? 0 })
    })
  })

  assert.deepEqual(result, { address: '8.8.8.8', family: 4 })
})