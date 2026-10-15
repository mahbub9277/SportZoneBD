import { z } from 'zod'
import { parseBooleanFlag } from '../../core/validation.js'
import { playbackUrlSchema } from '../../utils/playbackUrl.js'

const optionalLogoUrl = z.preprocess(
  (value) => (value === '' ? null : value),
  z.string().url().max(2048).nullable().optional(),
)
const optionalId = z.preprocess((value) => (value === '' ? null : value), z.string().uuid().nullable().optional())
const optionalViewers = z.preprocess(
  (value) => (value === '' || value === null || value === undefined ? null : Number(value)),
  z.number().int().nonnegative().nullable().optional(),
)

/**
 * The body of a channel create, and — through `.partial()` — of a channel update.
 *
 * `url` is the channel's playback source, so it is validated as one: a valid `http://` or `https://` URL
 * that is never rewritten. `isPremium` is normalised here from either a JSON boolean or the string a
 * form-encoded client sends, because the forms previously submitted `true` and the controller compared it
 * against the string `'true'`, which saved every channel as non-premium and cleared the flag on edit.
 */
export const channelSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: playbackUrlSchema,
  categoryId: z.string().uuid(),
  viewers: optionalViewers,
  isPremium: z.preprocess(parseBooleanFlag, z.boolean()).default(false),
  status: z.string().trim().min(1).max(32),
  logo: optionalLogoUrl,
})

export const channelUpdateSchema = channelSchema.partial()

export { optionalId as channelIdSchema }
