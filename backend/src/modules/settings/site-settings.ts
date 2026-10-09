import type { Request, Response } from 'express'
import asyncHandler from '../../utils/asyncHandler.js'
import { prisma } from '../../core/prisma.js'
import { successResponse } from '../../core/api-response.js'
import { cache } from '../../core/cache.js'

const CLOUDINARY_HOST = 'res.cloudinary.com'

/** Only an https Cloudinary *video* delivery URL may be stored or handed to a browser. */
export function isCloudinaryVideoUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === CLOUDINARY_HOST && url.pathname.includes('/video/upload/')
  } catch {
    return false
  }
}

/**
 * Site-wide settings that the admin UI writes through `/admin/settings`.
 *
 * Each entry carries its own validation so the admin write path and the public read below cannot drift
 * apart. `public` marks the keys that are safe to expose anonymously — every other key in the settings
 * table stays behind `admin.settings.manage`.
 */
export const siteSettings = {
  'match.prestart_video_url': {
    description: 'Optional MP4/WebM video shown on match pages before kick-off.',
    public: true,
    validate: (value: string) => value === '' || isCloudinaryVideoUrl(value),
  },
  'match.prestart_video_enabled': {
    description: 'Whether the configured pre-match video plays on match pages.',
    public: true,
    validate: (value: string) => value === 'true' || value === 'false',
  },
  'match.prestart_video_public_id': {
    description: 'Cloudinary public ID of the configured pre-match video, used to clean it up when replaced.',
    public: false,
    validate: (value: string) => value === '' || (/^[\w\-/.]{1,255}$/.test(value) && !value.includes('..')),
  },
} as const

export type SiteSettingKey = keyof typeof siteSettings

const PUBLIC_VIDEO_URL_KEY = 'match.prestart_video_url'
const PUBLIC_VIDEO_ENABLED_KEY = 'match.prestart_video_enabled'

export const publicSiteSettingKeys = Object.keys(siteSettings).filter(
  (key): key is SiteSettingKey => siteSettings[key as SiteSettingKey].public,
)

export const isSiteSettingKey = (key: string): key is SiteSettingKey => key in siteSettings

export interface PublicSiteSettings {
  prestartVideoUrl: string | null
  prestartVideoEnabled: boolean
}

const readPublicSiteSettings = async (): Promise<PublicSiteSettings> => {
  const rows = await prisma.setting.findMany({
    where: { deletedAt: null, key: { in: publicSiteSettingKeys } },
    select: { key: true, value: true },
  })
  const values = new Map(rows.map((row) => [row.key, row.value]))
  const storedUrl = values.get(PUBLIC_VIDEO_URL_KEY)?.trim() ?? ''

  return {
    // Re-validate on read so a value written before a rule change can never reach a browser.
    prestartVideoUrl: isCloudinaryVideoUrl(storedUrl) ? storedUrl : null,
    prestartVideoEnabled: (values.get(PUBLIC_VIDEO_ENABLED_KEY)?.trim() ?? 'true') === 'true',
  }
}

/**
 * Anonymous read of the visitor-safe site settings.
 *
 * The result goes through the existing `settings` cache tag, which `/admin/settings` already invalidates
 * on every write, so repeated page views cost one Redis GET instead of a database query.
 */
export const getPublicSiteSettings = asyncHandler(async (_req: Request, res: Response) => {
  const settings = await cache('settings:site:public', readPublicSiteSettings, 300, ['settings'])
  res.status(200).json(successResponse(settings))
})
