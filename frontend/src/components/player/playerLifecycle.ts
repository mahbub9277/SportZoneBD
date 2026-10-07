/**
 * The SportZoneBD playback lifecycle.
 *
 * Every playback surface (channel, match stream, highlight, mini player) reports its progress through
 * these actions and reads one status out of the reducer. The module is pure and timer-free except for
 * {@link createPlaybackWatchdog}, so the whole state machine and the error classification can be unit
 * tested without a browser.
 *
 * The two invariants this module exists to enforce:
 *  - the initial loader ends as soon as the current source has real data, or ends in an error state
 *    when nothing is arriving — it can never stay on screen forever;
 *  - an event that belongs to another source generation can never mutate the current source's state.
 */

export type PlaybackStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'buffering'
  | 'retrying'
  | 'error'
  | 'exhausted'

export type PlaybackErrorKind =
  | 'network'
  | 'timeout'
  | 'invalid_stream'
  | 'media'
  | 'decoder'
  | 'unsupported'
  | 'unknown'

/**
 * No-progress budget for one source attempt.
 *
 * This is deliberately a *no-progress* budget: every meaningful signal (manifest parsed, media data
 * available, fragment buffered, playback advancing) resets it, so a slow but live connection is never
 * killed, while a dead or hanging one cannot spin forever.
 */
export const INITIAL_PLAYBACK_TIMEOUT_MS = 12_000

/**
 * Attempts allowed on a single source before the player gives up on it: the URL as given, then the
 * same stream's alternate transport from `useHlsPlayer` (proxy backup, then direct URL). Each of those
 * is a distinct transport, so the loop is bounded at three attempts.
 */
export const MAX_SOURCE_ATTEMPTS = 3

export interface PlaybackLifecycleState {
  status: PlaybackStatus
  errorKind: PlaybackErrorKind | null
  /** Identity of the source this state describes; actions for other identities are ignored. */
  sourceKey: string
  /** Same-source attempts already running or finished (0 while the first attempt is in flight). */
  attempts: number
  /** Monotonic count of progress signals, used to reset the watchdog without re-rendering. */
  progressCount: number
  /** True while the player is waiting for the parent to hand over the next stream candidate. */
  awaitingCandidate: boolean
}

export type PlaybackLifecycleAction =
  | { type: 'SOURCE_START'; sourceKey: string }
  | { type: 'RENDITION_START'; sourceKey: string }
  | { type: 'PROGRESS'; sourceKey: string }
  | { type: 'MEDIA_READY'; sourceKey: string }
  | { type: 'PLAYING'; sourceKey: string }
  | { type: 'BUFFERING_START'; sourceKey: string }
  | { type: 'BUFFERING_END'; sourceKey: string }
  | { type: 'PAUSED'; sourceKey: string }
  | { type: 'RETRY'; sourceKey: string }
  | { type: 'AWAIT_CANDIDATE'; sourceKey: string }
  | { type: 'FAILED'; sourceKey: string; kind: PlaybackErrorKind }
  | { type: 'EXHAUSTED'; sourceKey: string }

export function initialPlaybackLifecycle(sourceKey: string): PlaybackLifecycleState {
  return {
    status: sourceKey ? 'loading' : 'idle',
    errorKind: null,
    sourceKey,
    attempts: 0,
    progressCount: 0,
    awaitingCandidate: false,
  }
}

export function playbackLifecycleReducer(state: PlaybackLifecycleState, action: PlaybackLifecycleAction): PlaybackLifecycleState {
  // A new source always resets the lifecycle, whatever the previous source was doing.
  if (action.type === 'SOURCE_START') {
    if (action.sourceKey === state.sourceKey && state.status === 'loading' && state.attempts === 0 && state.errorKind === null && !state.awaitingCandidate) {
      return state
    }
    return initialPlaybackLifecycle(action.sourceKey)
  }

  // Every other event belongs to one source generation, and late events from a previous channel,
  // highlight, rendition or retry must be dropped instead of mutating the current state.
  if (action.sourceKey !== state.sourceKey) return state

  switch (action.type) {
    case 'RENDITION_START':
      // A new rendition of the same source (a manual quality change) is a real media transition.
      return { ...state, status: 'loading', errorKind: null, awaitingCandidate: false, progressCount: 0 }
    case 'PROGRESS':
      return { ...state, progressCount: state.progressCount + 1 }
    case 'MEDIA_READY':
      // Readiness is level-triggered by the media element itself, so it is accepted from any state that
      // is still waiting for a first frame and it revives a source that was reported as failed. The
      // already-current cases return the same object so repeated level checks cannot churn renders.
      if (state.status === 'playing' || state.status === 'buffering') return state
      if (state.status === 'ready' && state.errorKind === null && !state.awaitingCandidate) return state
      return { ...state, status: 'ready', errorKind: null, awaitingCandidate: false }
    case 'PLAYING':
      if (state.status === 'playing' && state.errorKind === null && !state.awaitingCandidate) return state
      return { ...state, status: 'playing', errorKind: null, awaitingCandidate: false }
    case 'BUFFERING_START':
      // A stall is only meaningful once playback started; during the first load the initial loader
      // already describes what is happening.
      if (state.status === 'buffering') return state
      return state.status === 'playing' || state.status === 'ready'
        ? { ...state, status: 'buffering' }
        : state
    case 'BUFFERING_END':
      return state.status === 'buffering' ? { ...state, status: 'playing' } : state
    case 'PAUSED':
      // A viewer pausing is not buffering, even if the element had reported a stall just before.
      return state.status === 'buffering' ? { ...state, status: 'ready' } : state
    case 'RETRY':
      return { ...state, status: 'retrying', errorKind: null, awaitingCandidate: false, attempts: state.attempts + 1, progressCount: 0 }
    case 'AWAIT_CANDIDATE':
      // The parent owns the candidate list; attempts restart when the new source key arrives.
      return { ...state, status: 'retrying', errorKind: null, awaitingCandidate: true, attempts: 0, progressCount: 0 }
    case 'FAILED':
      return { ...state, status: 'error', errorKind: action.kind, awaitingCandidate: false }
    case 'EXHAUSTED':
      return { ...state, status: 'exhausted', errorKind: state.errorKind ?? 'unknown', awaitingCandidate: false }
    default:
      return state
  }
}

export function isTerminalPlaybackStatus(status: PlaybackStatus): boolean {
  return status === 'error' || status === 'exhausted'
}

/** True while the initial load of the current source attempt is still running. */
export function isInitialLoadStatus(status: PlaybackStatus): boolean {
  return status === 'idle' || status === 'loading' || status === 'retrying'
}

/** True when playback has produced at least one frame for the current source. */
export function hasStartedPlayback(status: PlaybackStatus): boolean {
  return status === 'playing' || status === 'buffering'
}

export function hasSourceAttemptsRemaining(state: PlaybackLifecycleState): boolean {
  return state.attempts + 1 < MAX_SOURCE_ATTEMPTS
}

/**
 * The single source of truth for the overlay: an initial load shows the loading variant, a stall after
 * playback started shows the buffering variant, and a terminal state shows nothing at all so the error
 * UI is never covered by a loader.
 */
export function playbackLoaderVariant(state: PlaybackLifecycleState): 'loading' | 'buffering' | null {
  if (isTerminalPlaybackStatus(state.status)) return null
  if (isInitialLoadStatus(state.status)) return state.status === 'idle' ? null : 'loading'
  return state.status === 'buffering' ? 'buffering' : null
}

/** Optional loader copy for the automatic recovery states. */
export function playbackLoaderLabel(state: PlaybackLifecycleState): string | undefined {
  if (state.status !== 'retrying') return undefined
  return state.awaitingCandidate ? 'Trying another stream…' : 'Retrying stream…'
}

export function playbackErrorMessage(kind: PlaybackErrorKind): string {
  switch (kind) {
    case 'network':
      return 'Connection problem. The stream could not be reached.'
    case 'timeout':
      return 'The stream took too long to respond.'
    case 'invalid_stream':
      return 'This stream is currently unavailable.'
    case 'media':
      return 'The stream stopped sending data. Please try again.'
    case 'decoder':
      return 'This stream cannot be played by the current browser.'
    case 'unsupported':
      return 'This stream format is not supported in this browser.'
    default:
      return 'Playback could not be started.'
  }
}

export function playbackExhaustedMessage(): string {
  return 'Every available source for this stream failed. Please try again.'
}

// ---------------------------------------------------------------- error classification

export interface PlaybackFailure {
  kind: PlaybackErrorKind
  /** Only a fatal failure ends the current attempt; non-fatal ones are recovered internally. */
  fatal: boolean
  /** Provider detail code, for telemetry only — never shown to viewers. */
  detail?: string
  status?: number
}

/** Builds a failure without leaving undefined keys behind, so the shape stays comparable in tests. */
function createFailure(kind: PlaybackErrorKind, fatal: boolean, detail?: string, status?: number): PlaybackFailure {
  const failure: PlaybackFailure = { kind, fatal }
  if (detail !== undefined) failure.detail = detail
  if (status !== undefined) failure.status = status
  return failure
}

const NETWORK_DETAILS = new Set([
  'manifestLoadError', 'levelLoadError', 'fragLoadError', 'keyLoadError',
  'audioTrackLoadError', 'subtitleTrackLoadError', 'assetListLoadError', 'steeringManifestLoadError',
])
const TIMEOUT_DETAILS = new Set([
  'manifestLoadTimeOut', 'levelLoadTimeOut', 'fragLoadTimeOut', 'keyLoadTimeOut',
  'audioTrackLoadTimeOut', 'subtitleTrackLoadTimeOut', 'assetListLoadTimeout',
])
const INVALID_STREAM_DETAILS = new Set([
  'manifestParsingError', 'manifestIncompatibleCodecsError', 'levelParsingError', 'levelEmptyError',
  'fragParsingError', 'fragDecryptError', 'levelSwitchError', 'assetListParsingError', 'interstitialAssetItemError',
])
const DECODER_DETAILS = new Set([
  'bufferIncompatibleCodecsError', 'bufferAddCodecError', 'bufferAppendError', 'bufferAppendingError',
  'remuxAllocError', 'internalException', 'attachMediaError',
])
const KEY_DETAILS = new Set([
  'keySystemError', 'keySystemNoKeys', 'keySystemNoAccess', 'keySystemLicenseRequestFailed',
  'keySystemNoSession', 'keySystemMediaKeysError', 'keySystemOutputRestricted',
])

/** HTTP failures that mean "this source does not exist for you" rather than "the network is broken". */
export function classifyHttpStatus(status?: number): PlaybackErrorKind {
  if (status === 401 || status === 403 || status === 404 || status === 410) return 'invalid_stream'
  return 'network'
}

export interface HlsErrorData {
  type?: string
  details?: string
  fatal?: boolean
  reason?: string
  response?: { code?: number; text?: string }
  status?: number
}

/**
 * Classifies an hls.js ERROR payload.
 *
 * hls.js reports recoverable problems without `fatal`, and those must not end the attempt. Buffer
 * stalls are always treated as a buffering condition (never as a source failure), because a live
 * stream that momentarily runs out of data is still a healthy source.
 */
export function classifyHlsError(data: HlsErrorData | null | undefined): PlaybackFailure | null {
  if (!data) return null

  const detail = typeof data.details === 'string' ? data.details : undefined
  const status = data.response?.code ?? data.status
  const fatal = data.fatal === true

  if (detail === 'bufferStalledError' || detail === 'bufferNudgeOnStall') {
    return createFailure('network', false, detail)
  }

  if (detail && NETWORK_DETAILS.has(detail)) {
    return createFailure(status !== undefined ? classifyHttpStatus(status) : 'network', fatal, detail, status)
  }
  if (detail && TIMEOUT_DETAILS.has(detail)) {
    return createFailure('timeout', fatal, detail)
  }
  if (detail && INVALID_STREAM_DETAILS.has(detail)) {
    return createFailure('invalid_stream', fatal, detail)
  }
  if (detail && DECODER_DETAILS.has(detail)) {
    return createFailure('decoder', fatal, detail)
  }
  if (detail && KEY_DETAILS.has(detail)) {
    return createFailure('invalid_stream', fatal, detail)
  }

  if (data.type === 'mediaError') return createFailure('media', fatal, detail)
  if (data.type === 'networkError') return createFailure('network', fatal, detail, status)
  if (data.type === 'keySystemError') return createFailure('invalid_stream', fatal, detail)
  // An unmapped internal (mux/other) error is only a source problem once hls.js calls it fatal.
  if (data.type === 'muxError' || data.type === 'otherError') return fatal ? createFailure('invalid_stream', true, detail) : null

  return fatal ? createFailure('unknown', true, detail) : null
}

/**
 * Classifies a native media element error.
 *
 * `MEDIA_ERR_ABORTED` is what the browser reports when the player itself released the source (a channel
 * switch, a rendition change, unmount), so it is never a real failure.
 */
export function classifyMediaError(error: { code?: number; message?: string } | null | undefined): PlaybackFailure | null {
  if (!error) return null

  const code = typeof error.code === 'number' ? error.code : undefined
  const message = typeof error.message === 'string' ? error.message : ''

  if (code === 1) return createFailure('unknown', false, 'aborted')
  if (code === 2) return createFailure('network', true, 'mediaNetworkError')
  if (code === 3) return createFailure('decoder', true, 'mediaDecodeError')
  if (code === 4) {
    return /not suitable|codec|decoder|media source/i.test(message)
      ? createFailure('decoder', true, 'mediaSrcNotSupported')
      : createFailure('unsupported', true, 'mediaSrcNotSupported')
  }

  if (/failed to init decoder|not suitable|decode/i.test(message)) return createFailure('decoder', true, 'decoderMessage')
  if (/network|fetch|load failed/i.test(message)) return createFailure('network', true, 'networkMessage')
  return createFailure('unknown', true, 'mediaError')
}

/** Classifies a rejected promise or thrown error from the player layer. */
export function classifyPlaybackException(error: unknown): PlaybackFailure | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as { name?: string; message?: string }
  const name = typeof candidate.name === 'string' ? candidate.name.toLowerCase() : ''
  const message = typeof candidate.message === 'string' ? candidate.message : ''

  if (name === 'aborterror' || /aborted/i.test(message)) return createFailure('unknown', false, 'aborted')
  if (name === 'notsupportederror' || /not suitable|codec|decoder|media source/i.test(message)) {
    return createFailure('unsupported', true, 'notSupported')
  }
  if (/network|fetch failed|econn|timeout|timed out/i.test(message)) return createFailure('network', true, 'networkException')
  return null
}

// ---------------------------------------------------------------- watchdog

export interface PlaybackWatchdog {
  arm: () => void
  reset: () => void
  disarm: () => void
  isArmed: () => boolean
}

/**
 * The bounded no-progress watchdog.
 *
 * It is armed for one source attempt and re-armed (not stacked) on every progress signal, so the
 * timeout only ever fires after a genuinely silent period. `arm` is idempotent, which keeps the call
 * sites free of bookkeeping.
 */
export function createPlaybackWatchdog(options: { onTimeout: () => void; timeoutMs?: number }): PlaybackWatchdog {
  const timeoutMs = options.timeoutMs ?? INITIAL_PLAYBACK_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | null = null

  const clear = () => {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  const arm = () => {
    clear()
    timer = setTimeout(() => {
      timer = null
      options.onTimeout()
    }, timeoutMs)
  }

  return {
    arm,
    reset: arm,
    disarm: clear,
    isArmed: () => timer !== null,
  }
}
