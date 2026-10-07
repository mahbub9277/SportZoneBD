import test from 'node:test'
import assert from 'node:assert/strict'
import {
  INITIAL_PLAYBACK_TIMEOUT_MS,
  MAX_SOURCE_ATTEMPTS,
  classifyHlsError,
  classifyHttpStatus,
  classifyMediaError,
  classifyPlaybackException,
  createPlaybackWatchdog,
  hasSourceAttemptsRemaining,
  initialPlaybackLifecycle,
  isTerminalPlaybackStatus,
  playbackErrorMessage,
  playbackExhaustedMessage,
  playbackLifecycleReducer,
  playbackLoaderLabel,
  playbackLoaderVariant,
  type PlaybackErrorKind,
  type PlaybackLifecycleAction,
  type PlaybackLifecycleState,
} from './playerLifecycle.ts'

const SOURCE = 'stream-1|https://cdn.example.com/live.m3u8'
const OTHER = 'stream-1|https://cdn.example.com/other.m3u8'

const run = (actions: PlaybackLifecycleAction[], start: PlaybackLifecycleState = initialPlaybackLifecycle(SOURCE)) =>
  actions.reduce(playbackLifecycleReducer, start)

const start = (sourceKey = SOURCE): PlaybackLifecycleAction => ({ type: 'SOURCE_START', sourceKey })

test('a valid highlight loads, becomes ready and plays without leaving the loader on screen', () => {
  const loading = run([start()])
  assert.equal(loading.status, 'loading')
  assert.equal(playbackLoaderVariant(loading), 'loading')

  const ready = run([start(), { type: 'PROGRESS', sourceKey: SOURCE }, { type: 'MEDIA_READY', sourceKey: SOURCE }], loading)
  assert.equal(ready.status, 'ready')
  assert.equal(playbackLoaderVariant(ready), null)

  const playing = playbackLifecycleReducer(ready, { type: 'PLAYING', sourceKey: SOURCE })
  assert.equal(playing.status, 'playing')
  assert.equal(playbackLoaderVariant(playing), null)
})

test('a valid HLS source hides the loader as soon as the manifest and media are ready', () => {
  const state = run([
    start(),
    { type: 'PROGRESS', sourceKey: SOURCE },
    { type: 'MEDIA_READY', sourceKey: SOURCE },
    { type: 'PLAYING', sourceKey: SOURCE },
  ])

  assert.equal(state.status, 'playing')
  assert.equal(playbackLoaderVariant(state), null)
  assert.ok(state.progressCount > 0)
})

test('a slow but progressing source keeps the loader without failing', () => {
  let state = run([start()])
  for (let index = 0; index < 6; index += 1) {
    state = playbackLifecycleReducer(state, { type: 'PROGRESS', sourceKey: SOURCE })
  }

  assert.equal(state.status, 'loading')
  assert.equal(playbackLoaderVariant(state), 'loading')
  assert.equal(state.progressCount, 6)
  assert.equal(isTerminalPlaybackStatus(state.status), false)
})

test('a dead source ends in a timeout failure instead of loading forever', () => {
  const state = playbackLifecycleReducer(run([start()]), { type: 'FAILED', sourceKey: SOURCE, kind: 'timeout' })

  assert.equal(state.status, 'error')
  assert.equal(state.errorKind, 'timeout')
  assert.equal(playbackLoaderVariant(state), null)
  assert.equal(playbackErrorMessage('timeout'), 'The stream took too long to respond.')
})

test('manifest load errors are classified as network problems, dead manifests as unavailable', () => {
  assert.deepEqual(classifyHlsError({ type: 'networkError', details: 'manifestLoadError', fatal: true, response: { code: 503 } }), {
    kind: 'network', fatal: true, detail: 'manifestLoadError', status: 503,
  })
  assert.deepEqual(classifyHlsError({ type: 'networkError', details: 'manifestLoadError', fatal: true, response: { code: 404 } }), {
    kind: 'invalid_stream', fatal: true, detail: 'manifestLoadError', status: 404,
  })
  assert.equal(classifyHlsError({ type: 'networkError', details: 'manifestLoadError', fatal: false })?.fatal, false)
  const nonFatal = classifyHlsError({ type: 'networkError', details: 'manifestLoadError', fatal: false })
  assert.equal(nonFatal?.kind, 'network')
  assert.equal(classifyHlsError({ type: 'otherError', details: 'unmappedDetail', fatal: false }), null)
  assert.equal(classifyHttpStatus(500), 'network')
  assert.equal(classifyHttpStatus(403), 'invalid_stream')
})

test('manifest timeouts and parsing errors are classified separately', () => {
  assert.equal(classifyHlsError({ type: 'networkError', details: 'manifestLoadTimeOut', fatal: true })?.kind, 'timeout')
  assert.equal(classifyHlsError({ type: 'networkError', details: 'levelLoadTimeOut', fatal: true })?.kind, 'timeout')
  assert.equal(classifyHlsError({ type: 'networkError', details: 'fragLoadTimeOut', fatal: true })?.kind, 'timeout')

  assert.equal(classifyHlsError({ type: 'networkError', details: 'manifestParsingError', fatal: true })?.kind, 'invalid_stream')
  assert.equal(classifyHlsError({ type: 'networkError', details: 'fragParsingError', fatal: true })?.kind, 'invalid_stream')
  assert.equal(classifyHlsError({ type: 'mediaError', details: 'bufferIncompatibleCodecsError', fatal: true })?.kind, 'decoder')
  assert.equal(classifyHlsError({ type: 'mediaError', details: 'bufferAppendError', fatal: true })?.kind, 'decoder')
  assert.equal(classifyHlsError({ type: 'otherError', details: 'internalException', fatal: true })?.kind, 'decoder')
  assert.equal(classifyHlsError({ type: 'networkError', details: 'levelLoadError', fatal: true })?.detail, 'levelLoadError')
  assert.equal(classifyHlsError({ type: 'networkError', details: 'unknownDetail', fatal: true })?.kind, 'network')
})

test('a buffer stall is a buffering condition, never an initial source failure', () => {
  const stall = classifyHlsError({ type: 'mediaError', details: 'bufferStalledError', fatal: false })
  assert.equal(stall?.fatal, false)
  assert.equal(stall?.detail, 'bufferStalledError')

  const state = run([
    start(),
    { type: 'MEDIA_READY', sourceKey: SOURCE },
    { type: 'PLAYING', sourceKey: SOURCE },
    { type: 'BUFFERING_START', sourceKey: SOURCE },
  ])

  assert.equal(state.status, 'buffering')
  assert.equal(playbackLoaderVariant(state), 'buffering')

  const resumed = playbackLifecycleReducer(state, { type: 'BUFFERING_END', sourceKey: SOURCE })
  assert.equal(resumed.status, 'playing')
  assert.equal(playbackLoaderVariant(resumed), null)
})

test('the initial loader never returns while playback merely buffers', () => {
  const state = run([
    start(),
    { type: 'MEDIA_READY', sourceKey: SOURCE },
    { type: 'PLAYING', sourceKey: SOURCE },
    { type: 'BUFFERING_START', sourceKey: SOURCE },
  ])

  assert.notEqual(playbackLoaderVariant(state), 'loading')
  assert.equal(playbackLoaderVariant(state), 'buffering')
  assert.equal(playbackLoaderLabel(state), undefined)
})

test('buffering events during the first load do not end the initial loader', () => {
  const state = run([start(), { type: 'BUFFERING_START', sourceKey: SOURCE }, { type: 'PROGRESS', sourceKey: SOURCE }])

  assert.equal(state.status, 'loading')
  assert.equal(playbackLoaderVariant(state), 'loading')
})

test('pausing never shows buffering', () => {
  const buffering = run([
    start(),
    { type: 'PLAYING', sourceKey: SOURCE },
    { type: 'BUFFERING_START', sourceKey: SOURCE },
  ])
  const paused = playbackLifecycleReducer(buffering, { type: 'PAUSED', sourceKey: SOURCE })

  assert.equal(paused.status, 'ready')
  assert.equal(playbackLoaderVariant(paused), null)

  const pausedWhileLoading = playbackLifecycleReducer(initialPlaybackLifecycle(SOURCE), { type: 'PAUSED', sourceKey: SOURCE })
  assert.equal(pausedWhileLoading.status, 'loading')
})

test('events from an old source never mutate the current source state', () => {
  const current = run([start(), { type: 'MEDIA_READY', sourceKey: SOURCE }, { type: 'PLAYING', sourceKey: SOURCE }])
  const staleActions: PlaybackLifecycleAction[] = [
    { type: 'PROGRESS', sourceKey: OTHER },
    { type: 'MEDIA_READY', sourceKey: OTHER },
    { type: 'PLAYING', sourceKey: OTHER },
    { type: 'BUFFERING_START', sourceKey: OTHER },
    { type: 'FAILED', sourceKey: OTHER, kind: 'network' },
    { type: 'EXHAUSTED', sourceKey: OTHER },
    { type: 'RETRY', sourceKey: OTHER },
  ]

  const after = run(staleActions, current)
  assert.equal(after, current)
  assert.equal(after.status, 'playing')
})

test('a source start for a new key resets the lifecycle even from a playing state', () => {
  const playing = run([start(), { type: 'PLAYING', sourceKey: SOURCE }])
  const switched = playbackLifecycleReducer(playing, start(OTHER))

  assert.equal(switched.status, 'loading')
  assert.equal(switched.sourceKey, OTHER)
  assert.equal(switched.attempts, 0)
  assert.equal(switched.progressCount, 0)
  assert.equal(playbackLoaderVariant(switched), 'loading')
})

test('a retry creates a new attempt for the same source and re-arms the initial loader', () => {
  const failed = run([start(), { type: 'FAILED', sourceKey: SOURCE, kind: 'network' }])
  const retrying = playbackLifecycleReducer(failed, { type: 'RETRY', sourceKey: SOURCE })

  assert.equal(retrying.status, 'retrying')
  assert.equal(retrying.attempts, 1)
  assert.equal(retrying.errorKind, null)
  assert.equal(playbackLoaderVariant(retrying), 'loading')
  assert.equal(playbackLoaderLabel(retrying), 'Retrying stream…')
  assert.equal(hasSourceAttemptsRemaining(retrying), true)

  const second = playbackLifecycleReducer(retrying, { type: 'RETRY', sourceKey: SOURCE })
  assert.equal(second.attempts, 2)
  assert.equal(hasSourceAttemptsRemaining(second), false)
  assert.equal(MAX_SOURCE_ATTEMPTS, 3)
})

test('waiting for another stream candidate is announced instead of failing', () => {
  const state = playbackLifecycleReducer(
    run([start(), { type: 'FAILED', sourceKey: SOURCE, kind: 'timeout' }]),
    { type: 'AWAIT_CANDIDATE', sourceKey: SOURCE },
  )

  assert.equal(state.status, 'retrying')
  assert.equal(state.awaitingCandidate, true)
  assert.equal(playbackLoaderLabel(state), 'Trying another stream…')
  assert.equal(playbackLoaderVariant(state), 'loading')
})

test('an exhausted chain is terminal and never shows a loader', () => {
  const state = run([start(), { type: 'FAILED', sourceKey: SOURCE, kind: 'network' }, { type: 'EXHAUSTED', sourceKey: SOURCE }])

  assert.equal(state.status, 'exhausted')
  assert.equal(state.errorKind, 'network')
  assert.equal(isTerminalPlaybackStatus(state.status), true)
  assert.equal(playbackLoaderVariant(state), null)
  assert.ok(playbackExhaustedMessage().length > 0)
})

test('playback that starts after a reported failure recovers instead of staying in the error state', () => {
  const state = run([
    start(),
    { type: 'FAILED', sourceKey: SOURCE, kind: 'timeout' },
    { type: 'PLAYING', sourceKey: SOURCE },
  ])

  assert.equal(state.status, 'playing')
  assert.equal(state.errorKind, null)
  assert.equal(playbackLoaderVariant(state), null)
})

test('a rendition change reloads the loader for the new rendition and keeps the attempt count', () => {
  const playing = run([start(), { type: 'PLAYING', sourceKey: SOURCE }])
  const retrying = playbackLifecycleReducer(playing, { type: 'RETRY', sourceKey: SOURCE })
  const rendition = playbackLifecycleReducer(retrying, { type: 'RENDITION_START', sourceKey: SOURCE })

  assert.equal(rendition.status, 'loading')
  assert.equal(rendition.attempts, retrying.attempts)
  assert.equal(playbackLoaderVariant(rendition), 'loading')

  const ready = playbackLifecycleReducer(rendition, { type: 'MEDIA_READY', sourceKey: SOURCE })
  assert.equal(playbackLoaderVariant(ready), null)
})

test('native media errors are classified by kind and aborted loads are ignored', () => {
  assert.equal(classifyMediaError({ code: 1 })?.fatal, false)
  assert.equal(classifyMediaError({ code: 2 })?.kind, 'network')
  assert.equal(classifyMediaError({ code: 3 })?.kind, 'decoder')
  assert.equal(classifyMediaError({ code: 4 })?.kind, 'unsupported')
  assert.equal(classifyMediaError({ code: 4, message: 'not suitable' })?.kind, 'decoder')
  assert.equal(classifyMediaError({ code: 3, message: 'Failed to init decoder' })?.kind, 'decoder')
  assert.equal(classifyMediaError(null), null)

  assert.equal(classifyPlaybackException(new DOMException('fetching process for the media resource was aborted', 'AbortError'))?.fatal, false)
  assert.equal(classifyPlaybackException(new DOMException('not suitable', 'NotSupportedError'))?.kind, 'unsupported')
  assert.equal(classifyPlaybackException(new TypeError('fetch failed'))?.kind, 'network')
  assert.equal(classifyPlaybackException('nope'), null)
})

test('every error kind has viewer-facing copy without technical detail', () => {
  const kinds: PlaybackErrorKind[] = ['network', 'timeout', 'invalid_stream', 'media', 'decoder', 'unsupported', 'unknown']
  for (const kind of kinds) {
    const message = playbackErrorMessage(kind)
    assert.ok(message.length > 10, `copy for ${kind}`)
    assert.doesNotMatch(message, /https?:|m3u8|hls\.js|Error:|undefined/i, `copy for ${kind}`)
  }
})

test('the watchdog fires only after a silent period and is reset by progress', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let expired = 0
  const watchdog = createPlaybackWatchdog({ onTimeout: () => { expired += 1 } })

  watchdog.arm()
  assert.equal(watchdog.isArmed(), true)
  t.mock.timers.tick(INITIAL_PLAYBACK_TIMEOUT_MS - 1)
  assert.equal(expired, 0)

  // Progress shortly before the deadline must restart the budget.
  watchdog.reset()
  t.mock.timers.tick(INITIAL_PLAYBACK_TIMEOUT_MS - 1)
  assert.equal(expired, 0)

  t.mock.timers.tick(2)
  assert.equal(expired, 1)
  assert.equal(watchdog.isArmed(), false)
})

test('the watchdog stops firing once it is disarmed by readiness, error or unmount', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let expired = 0
  const watchdog = createPlaybackWatchdog({ onTimeout: () => { expired += 1 } })

  watchdog.arm()
  watchdog.disarm()
  t.mock.timers.tick(INITIAL_PLAYBACK_TIMEOUT_MS * 3)
  assert.equal(expired, 0)
  assert.equal(watchdog.isArmed(), false)

  watchdog.reset()
  assert.equal(watchdog.isArmed(), true)
  watchdog.disarm()
  t.mock.timers.tick(INITIAL_PLAYBACK_TIMEOUT_MS * 2)
  assert.equal(expired, 0)
})

test('a timeout is only possible while the initial load is running', () => {
  const states: Array<[PlaybackLifecycleState, boolean]> = [
    [run([start()]), true],
    [run([start(), { type: 'MEDIA_READY', sourceKey: SOURCE }]), false],
    [run([start(), { type: 'PLAYING', sourceKey: SOURCE }]), false],
    [run([start(), { type: 'PLAYING', sourceKey: SOURCE }, { type: 'BUFFERING_START', sourceKey: SOURCE }]), false],
    [run([start(), { type: 'FAILED', sourceKey: SOURCE, kind: 'network' }]), false],
    [run([start(), { type: 'FAILED', sourceKey: SOURCE, kind: 'network' }, { type: 'EXHAUSTED', sourceKey: SOURCE }]), false],
    [run([start(), { type: 'FAILED', sourceKey: SOURCE, kind: 'network' }, { type: 'RETRY', sourceKey: SOURCE }]), true],
  ]

  for (const [state, expected] of states) {
    assert.equal(playbackLoaderVariant(state) === 'loading' || state.status === 'retrying', expected, state.status)
  }
})

test('repeated level-driven signals do not churn the lifecycle state', () => {
  const ready = run([start(), { type: 'MEDIA_READY', sourceKey: SOURCE }])
  assert.equal(playbackLifecycleReducer(ready, { type: 'MEDIA_READY', sourceKey: SOURCE }), ready)

  const playing = playbackLifecycleReducer(ready, { type: 'PLAYING', sourceKey: SOURCE })
  assert.equal(playbackLifecycleReducer(playing, { type: 'PLAYING', sourceKey: SOURCE }), playing)
  assert.equal(playbackLifecycleReducer(playing, { type: 'MEDIA_READY', sourceKey: SOURCE }), playing)

  const buffering = playbackLifecycleReducer(playing, { type: 'BUFFERING_START', sourceKey: SOURCE })
  assert.equal(playbackLifecycleReducer(buffering, { type: 'BUFFERING_START', sourceKey: SOURCE }), buffering)
  assert.equal(playbackLifecycleReducer(playing, { type: 'BUFFERING_END', sourceKey: SOURCE }), playing)
  assert.equal(playbackLifecycleReducer(playing, { type: 'PAUSED', sourceKey: SOURCE }), playing)
})

test('terminal errors and loaders are mutually exclusive', () => {
  const terminalStates: PlaybackLifecycleState[] = [
    run([start(), { type: 'FAILED', sourceKey: SOURCE, kind: 'timeout' }]),
    run([start(), { type: 'FAILED', sourceKey: SOURCE, kind: 'decoder' }, { type: 'EXHAUSTED', sourceKey: SOURCE }]),
  ]

  for (const state of terminalStates) {
    assert.equal(isTerminalPlaybackStatus(state.status), true)
    assert.equal(playbackLoaderVariant(state), null)
  }
})
