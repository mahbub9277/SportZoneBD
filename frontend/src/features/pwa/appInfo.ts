import packageJson from '../../../package.json'

export const APP_VERSION = packageJson.version
export const APP_PUBLIC_URL = 'https://sport-zone-bd.vercel.app'

export interface ReleaseNoteCategory {
  category: 'New' | 'Improvements' | 'Fixes' | 'Security'
  items: string[]
}

export const RELEASE_NOTES_BY_VERSION: Record<string, ReleaseNoteCategory[]> = {
  '2.0.0': [
    {
      category: 'Improvements',
      items: [
        'Streaming pages navigate and settle faster, with quieter page and banner transitions.',
        'Live viewer counts and player telemetry now use noticeably fewer Redis operations.',
        'Finished matches are cleared automatically shortly after they end, keeping the match list current.',
      ],
    },
    {
      category: 'Fixes',
      items: [
        'Dark and light themes apply on the first paint, removing the flash when the app loads.',
        'The player banner toggle no longer shifts or jitters the video below it.',
      ],
    },
    {
      category: 'Security',
      items: [
        'Google sign-in verifies the OAuth state of the browser that started the flow.',
      ],
    },
  ],
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