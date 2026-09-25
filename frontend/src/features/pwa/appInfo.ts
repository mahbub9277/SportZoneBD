import packageJson from '../../../package.json'

export const APP_VERSION = packageJson.version
export const APP_PUBLIC_URL = 'https://sport-zone-bd.vercel.app'

export interface ReleaseNoteCategory {
  category: 'New' | 'Improvements' | 'Fixes' | 'Security'
  items: string[]
}

export const RELEASE_NOTES_BY_VERSION: Record<string, ReleaseNoteCategory[]> = {
  '1.0.1': [
    {
      category: 'Improvements',
      items: [
        'App version is consistent across the About screen and startup experience.',
        'PWA shell updates follow the release version and remain user-controlled.',
      ],
    },
  ],
}
export const CURRENT_RELEASE_NOTES = RELEASE_NOTES_BY_VERSION[APP_VERSION] ?? []

export function getAppShareUrl(): string {
  if (import.meta.env.PROD && typeof window !== 'undefined') return window.location.origin
  return APP_PUBLIC_URL
}