/**
 * What a request log line is allowed to contain.
 *
 * A production log line showed the ZiniPay callback URL with its query string, which carries a customer email,
 * a sender number, a transaction reference and payment identifiers, and it showed every request header,
 * including provider API keys. None of that belongs in a log: an operator needs to know *which* request ran,
 * how it ended and how to correlate it, and nothing about the payment data inside it.
 *
 * So the request serializer below is an allowlist rather than a filter. It keeps the method, the path without
 * its query string, the request id, the client address and a short list of non-identifying headers (the ones
 * used to distinguish a browser from a bot or a client from a proxy), and drops everything else — `query`,
 * `params` and all other headers never reach a log line at all. The response serializer keeps the status code
 * only, because response headers carry `Set-Cookie` credentials.
 */

/** Headers that say something operationally useful and can never identify a customer or carry a credential. */
export const SAFE_REQUEST_HEADERS: readonly string[] = [
  'user-agent',
  'content-type',
  'accept',
  'accept-language',
  'x-request-id',
  'x-requested-with',
] as const

/**
 * Strips everything after the path: the query string and the fragment.
 *
 * Works on the shapes Node and Express hand over (`/api/v1/x?a=b`, `https://host/api/v1/x?a=b`, `#frag`), and
 * returns undefined for a missing value so a log line never shows an empty field as if it were a path.
 */
export function pathOnly(rawUrl: string | undefined | null): string | undefined {
  if (!rawUrl) return undefined
  const cut = rawUrl.search(/[?#]/)
  const path = cut === -1 ? rawUrl : rawUrl.slice(0, cut)
  return path || undefined
}

/** Only the allow-listed headers, lower-cased, with at most one value per name. */
export function safeRequestHeaders(headers: unknown): Record<string, string> {
  if (typeof headers !== 'object' || headers === null) return {}

  const source = headers as Record<string, unknown>
  const safe: Record<string, string> = {}

  for (const name of SAFE_REQUEST_HEADERS) {
    const value = source[name]
    if (typeof value === 'string' && value) {
      safe[name] = value.slice(0, 200)
    } else if (Array.isArray(value) && typeof value[0] === 'string' && value[0]) {
      safe[name] = value[0].slice(0, 200)
    }
  }

  return safe
}

/** The request as it is handed to a serializer by pino-http. */
export interface LoggedRequest {
  id?: unknown
  method?: unknown
  originalUrl?: unknown
  url?: unknown
  headers?: unknown
  socket?: { remoteAddress?: string }
  /** Present on an Express request. Accepted and deliberately not logged. */
  params?: unknown
  /** Present on an Express request. Accepted and deliberately not logged: it is the raw query string parsed. */
  query?: unknown
}

export interface RequestLogLine {
  id?: string
  method?: string
  /** The path only: a query string may carry customer and payment data. */
  url?: string
  headers: Record<string, string>
  remoteAddress?: string
}

/** The request half of a log line: method, path, id, client address and the safe headers. */
export function requestLogSerializer(req: LoggedRequest): RequestLogLine {
  const id = typeof req.id === 'string' || typeof req.id === 'number' ? String(req.id) : undefined
  const method = typeof req.method === 'string' ? req.method : undefined
  const rawUrl = typeof req.originalUrl === 'string' ? req.originalUrl : (typeof req.url === 'string' ? req.url : undefined)

  return {
    ...(id ? { id } : {}),
    ...(method ? { method } : {}),
    ...(pathOnly(rawUrl) ? { url: pathOnly(rawUrl) } : {}),
    // `query` and `params` are deliberately absent: neither is needed to operate the API and both can carry
    // payment references.
    headers: safeRequestHeaders(req.headers),
    ...(req.socket?.remoteAddress ? { remoteAddress: req.socket.remoteAddress } : {}),
  }
}

/** The response half of a log line: the status code and nothing else (headers carry `Set-Cookie`). */
export function responseLogSerializer(res: { statusCode?: number }): { statusCode?: number } {
  return { statusCode: res.statusCode }
}

/** The serializer pair the HTTP logger is configured with. */
export const REQUEST_LOG_SERIALIZERS = {
  req: requestLogSerializer,
  res: responseLogSerializer,
}

/**
 * The one-line summary written for a finished request: `METHOD /path - 200 OK [- reason]`.
 *
 * `req.url` is the request line, so it carries the query string; only its path is used here.
 */
export function requestLogSummary(
  method: string | undefined,
  url: string | undefined,
  statusCode: number,
  statusText: string,
  reason?: string,
): string {
  return `${method ?? 'UNKNOWN'} ${pathOnly(url) ?? ''} - ${statusCode} ${statusText}${reason ? ` - ${reason}` : ''}`
}
