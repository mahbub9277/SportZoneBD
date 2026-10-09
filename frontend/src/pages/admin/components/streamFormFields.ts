/**
 * The field vocabulary the standalone stream form and the stream cards inside the match form share.
 *
 * Both surfaces edit the same stream record, so the option values, their labels and the way a status is
 * coloured are defined once here. They used to be written twice, which is how two screens end up
 * offering the same field with different wording — or different options entirely.
 */

/** Same team-logo source and transform the match management rows use. */
export const teamLogoTransform = {
  width: 64,
  height: 64,
  crop: 'fill' as const,
  gravity: 'auto' as const,
  quality: 'auto' as const,
  format: 'auto' as const,
}

export type StreamSourceType = 'DIRECT_URL' | 'CHANNEL'
export type StreamStatusValue = 'READY' | 'LIVE' | 'OFFLINE' | 'ERROR'

export const STREAM_SOURCE_TYPE_OPTIONS: ReadonlyArray<{ value: StreamSourceType; label: string }> = [
  { value: 'DIRECT_URL', label: 'Match stream' },
  { value: 'CHANNEL', label: 'Existing channel' },
]

export const STREAM_STATUS_OPTIONS: ReadonlyArray<{ value: StreamStatusValue; label: string }> = [
  { value: 'READY', label: 'Ready' },
  { value: 'LIVE', label: 'Live' },
  { value: 'OFFLINE', label: 'Offline' },
  { value: 'ERROR', label: 'Error' },
]

export const STREAM_STATUS_LABELS: Record<StreamStatusValue, string> = {
  READY: 'Ready',
  LIVE: 'Live',
  OFFLINE: 'Offline',
  ERROR: 'Error',
}

/**
 * The status chip. Red is reserved for a stream that is failing, so only ERROR and OFFLINE use it;
 * a stream that is ready or live is a healthy state and is shown in the app's live green.
 */
export const STREAM_STATUS_CHIP_CLASS: Record<StreamStatusValue, string> = {
  READY: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  LIVE: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  OFFLINE: 'border-slate-400/30 bg-slate-500/10 text-(--text-muted)',
  ERROR: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300',
}

/** The source-type select shared by both surfaces. */
export const streamSourceTypeLabel = (value: StreamSourceType | null | undefined): string =>
  STREAM_SOURCE_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? STREAM_SOURCE_TYPE_OPTIONS[0].label
