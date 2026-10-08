import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  isAutoTuneScanComplete,
  pickAutoTuneChannel,
  startAutoTuneScan,
  stepAutoTuneScan,
  type AutoTuneScanState,
} from './autoTune'
import type { TVChannel } from './tvChannels'

export type AutoTuneStatus = 'idle' | 'scanning' | 'completed' | 'empty' | 'error'

export interface AutoTuneApi {
  status: AutoTuneStatus
  /** Catalogue entries visited so far — also the cursor, because every entry is visited exactly once. */
  scanned: number
  /** Size of the catalogue the scan is working through. */
  total: number
  /** The entry being validated, for the "current channel" readout. */
  currentChannel: TVChannel | null
  /** The channels this viewer could watch, in catalogue order. */
  found: TVChannel[]
  /** True while the scan is running, so the UI can show progress and offer a cancel. */
  isScanning: boolean
  start: () => void
  /** Stops the scan, clears its timer and returns the feature to idle. */
  cancel: () => void
  /** Tunes to the best result through the caller's existing selection path, then goes idle. */
  accept: () => void
}

interface UseAutoTuneOptions {
  channels: TVChannel[]
  isPremiumSubscriber: boolean
  selectedChannelId: string | null
  /** Tunes to the accepted channel; the page passes its existing channel-selection function. */
  onAccept: (channel: TVChannel) => void
  /** Called as a scan starts, so the page can stop any automatic recovery it has pending. */
  onScanStart?: () => void
}

/**
 * Catalogue entries validated per slice.
 *
 * The scan reads metadata the page already has, so a slice is microseconds of work; the tick interval
 * exists to give a yield point for repainting and for cancellation, and the slice size is what decides
 * how long a full scan takes. Three per tick over a few hundred channels stays a couple of seconds.
 */
const SCAN_SLICE_SIZE = 3
const SCAN_TICK_MS = 48
/** Progress is flushed to React at most this often, so a scan cannot drive a render per micro-step. */
const SCAN_FLUSH_MS = 90

interface AutoTuneViewState {
  status: AutoTuneStatus
  scanned: number
  currentChannel: TVChannel | null
  found: TVChannel[]
}

const IDLE_STATE: AutoTuneViewState = { status: 'idle', scanned: 0, currentChannel: null, found: [] }

/**
 * Auto Tune.
 *
 * A user-started scan of the real catalogue. It reads the same eligibility rule the rest of TV Mode
 * uses, one bounded slice at a time, and never touches a stream URL, the player, the API or the socket:
 * the whole feature is a paced walk over data the page already holds.
 *
 * All of its state is local to TV Mode and lives here, and its single timer is cleared by every way out
 * of a scan — cancel, completion, a new scan, or unmount.
 */
export function useAutoTune({
  channels,
  isPremiumSubscriber,
  selectedChannelId,
  onAccept,
  onScanStart,
}: UseAutoTuneOptions): AutoTuneApi {
  const [state, setState] = useState<AutoTuneViewState>(IDLE_STATE)

  const scanRef = useRef<AutoTuneScanState | null>(null)
  const timerRef = useRef<number | null>(null)
  const lastFlushRef = useRef(0)
  const tickRef = useRef<() => void>(() => {})

  // The scan reads the catalogue as it is on each tick, so a refresh landing mid-scan is picked up
  // instead of being scanned from a stale snapshot.
  const channelsRef = useRef(channels)
  const premiumRef = useRef(isPremiumSubscriber)
  useEffect(() => {
    channelsRef.current = channels
  }, [channels])
  useEffect(() => {
    premiumRef.current = isPremiumSubscriber
  }, [isPremiumSubscriber])

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const finish = useCallback((scan: AutoTuneScanState) => {
    clearTimer()
    scanRef.current = null
    setState({
      status: scan.found.length > 0 ? 'completed' : 'empty',
      scanned: scan.scanned,
      currentChannel: scan.currentChannel,
      found: scan.found,
    })
  }, [clearTimer])

  /**
   * One slice, then a yield point.
   *
   * The slice is always processed before the repaint check, so the scan makes progress even when the
   * flush is throttled; only the *rendering* is batched.
   */
  const runSlice = useCallback(() => {
    timerRef.current = null
    const scan = scanRef.current
    if (!scan) return

    try {
      const next = stepAutoTuneScan(scan, channelsRef.current, premiumRef.current, SCAN_SLICE_SIZE)
      scanRef.current = next

      if (isAutoTuneScanComplete(next, channelsRef.current)) {
        finish(next)
        return
      }

      const now = performance.now()
      if (now - lastFlushRef.current >= SCAN_FLUSH_MS) {
        lastFlushRef.current = now
        setState({ status: 'scanning', scanned: next.scanned, currentChannel: next.currentChannel, found: next.found })
      }

      timerRef.current = window.setTimeout(() => tickRef.current(), SCAN_TICK_MS)
    } catch {
      // A scan that cannot continue ends in a state the viewer can act on rather than a broken screen.
      clearTimer()
      scanRef.current = null
      setState({ status: 'error', scanned: 0, currentChannel: null, found: [] })
    }
  }, [clearTimer, finish])

  useEffect(() => {
    tickRef.current = runSlice
  }, [runSlice])

  const start = useCallback(() => {
    clearTimer()
    scanRef.current = startAutoTuneScan()
    lastFlushRef.current = performance.now()
    onScanStart?.()
    setState({ status: 'scanning', scanned: 0, currentChannel: null, found: [] })

    // An empty catalogue is finished before it starts: there is nothing to sweep and nothing to invent.
    if (channelsRef.current.length === 0) {
      finish(startAutoTuneScan())
      return
    }

    timerRef.current = window.setTimeout(() => tickRef.current(), SCAN_TICK_MS)
  }, [clearTimer, finish, onScanStart])

  const cancel = useCallback(() => {
    clearTimer()
    scanRef.current = null
    setState(IDLE_STATE)
  }, [clearTimer])

  const accept = useCallback(() => {
    const channel = pickAutoTuneChannel(state.found, selectedChannelId)
    clearTimer()
    scanRef.current = null
    setState(IDLE_STATE)
    if (channel) onAccept(channel)
  }, [clearTimer, onAccept, selectedChannelId, state.found])

  // Nothing may keep running after TV Mode is left.
  useEffect(() => () => clearTimer(), [clearTimer])

  return useMemo(() => ({
    status: state.status,
    scanned: state.scanned,
    total: channels.length,
    currentChannel: state.currentChannel,
    found: state.found,
    isScanning: state.status === 'scanning',
    start,
    cancel,
    accept,
  }), [accept, cancel, channels.length, start, state])
}
