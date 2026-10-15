import { z } from 'zod'

/** The protocols a playback source may use: what the browser and the manifest proxy can both serve. */
const allowedPlaybackProtocols = new Set(['http:', 'https:'])

/**
 * A URL an operator may configure as a playback source.
 *
 * Both schemes are accepted — providers legitimately serve HTTP and the app plays it wherever the browser
 * permits — but the value is never rewritten, and nothing else is accepted: `file:`, `data:`, `ftp:` or a
 * malformed string would only travel through the media stack, the proxy and the SSRF guard to be refused
 * at the far end. The limit matches the one Prisma stores and the proxy already enforces.
 */
export const playbackUrlSchema = z
  .string()
  .trim()
  .min(1, 'A playback URL is required')
  .max(2048)
  .refine((value) => {
    try {
      return allowedPlaybackProtocols.has(new URL(value).protocol)
    } catch {
      return false
    }
  }, 'A playback URL must be a valid http:// or https:// URL')

/** A playback URL that may also be absent, in which case `''` is stored as no value at all. */
export const optionalPlaybackUrlSchema = z.preprocess(
  (value) => (value === '' ? null : value),
  playbackUrlSchema.nullable().optional(),
)

/** A primary URL that may still be empty, because a channel-sourced stream takes its URL from the channel. */
export const playbackUrlOrEmptySchema = z.union([playbackUrlSchema, z.literal('')]).optional()
