import { z } from 'zod'
import { optionalPlaybackUrlSchema, playbackUrlOrEmptySchema } from '../../utils/playbackUrl.js'

const optionalUrl = z.preprocess((value) => (value === '' ? null : value), z.string().url().nullable().optional())

/**
 * The body of a stream create, and — through `.partial()` — of a stream update.
 *
 * The playback URLs are the only fields the pipeline depends on, so they are the ones validated: the
 * primary may be empty because a channel-sourced stream takes its URL from the channel it links to, and the
 * backup carries the primary→backup failover. A partial update leaves every omitted property out of the
 * parsed body entirely, which is what keeps the stored value untouched.
 */
export const streamSchema = z.object({
  matchId: z.string().uuid(),
  name: z.string().trim().min(2).max(80).default('Main stream'),
  logo: optionalUrl,
  sourceType: z.enum(['DIRECT_URL', 'CHANNEL']).default('DIRECT_URL'),
  channelId: z.preprocess((value) => (value === '' ? null : value), z.string().uuid().nullable().optional()),
  primaryUrl: playbackUrlOrEmptySchema,
  backupUrl: optionalPlaybackUrlSchema,
  enabled: z.preprocess((value) => typeof value === 'string' ? value.toLowerCase() === 'true' : value, z.boolean()).default(true),
  status: z.enum(['READY', 'LIVE', 'OFFLINE', 'ERROR']).default('READY'),
  quality: z.string().trim().min(1).max(32).default('auto'),
  activationMode: z.enum(['AUTOMATIC', 'MANUAL']).default('AUTOMATIC'),
  activationOffsetMinutes: z.preprocess((value) => Number(value ?? 0), z.number().int().min(0).max(10080)).default(0),
})

export const streamUpdateSchema = streamSchema.partial()
