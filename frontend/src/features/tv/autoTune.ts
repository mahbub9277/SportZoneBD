// The extension is explicit because this module is also loaded by the Node test runner, which resolves
// its own import graph rather than going through the bundler.
import { isChannelWatchable, type TVChannel } from './tvChannels.ts'

/**
 * The pure half of Auto Tune: the scan walks the real catalogue in bounded slices and keeps the
 * channels the viewer could actually watch, according to the same eligibility rule the rest of TV Mode
 * uses. Nothing here touches the network, a timer or the player, which is what makes the progress
 * arithmetic and the eligibility decisions testable on their own.
 *
 * `scanned` is both the count so far and the cursor into the catalogue: every entry is visited exactly
 * once, so the scan can neither re-read a channel nor invent one.
 */
export interface AutoTuneScanState {
  scanned: number
  /** Channels this viewer could actually watch, in catalogue order. */
  found: TVChannel[]
  /** The entry visited last, for the "currently tuning" readout. */
  currentChannel: TVChannel | null
}

export function startAutoTuneScan(): AutoTuneScanState {
  return { scanned: 0, found: [], currentChannel: null }
}

/**
 * Advances the scan by at most `sliceSize` catalogue entries.
 *
 * The slice is deliberate: it gives the caller a yield point where the UI can repaint and where a
 * cancellation takes effect, which keeps the scan off the main thread's critical path and means a
 * large catalogue can never freeze the interface.
 */
export function stepAutoTuneScan(
  state: AutoTuneScanState,
  channels: TVChannel[],
  isPremiumSubscriber: boolean,
  sliceSize: number,
): AutoTuneScanState {
  const size = Math.max(1, Math.floor(sliceSize))
  const end = Math.min(channels.length, state.scanned + size)
  if (end <= state.scanned) return state

  const found = state.found.slice()
  let currentChannel = state.currentChannel

  for (let index = state.scanned; index < end; index += 1) {
    const channel = channels[index]
    currentChannel = channel
    if (isChannelWatchable(channel, isPremiumSubscriber)) found.push(channel)
  }

  return { scanned: end, found, currentChannel }
}

export function isAutoTuneScanComplete(state: AutoTuneScanState, channels: TVChannel[]): boolean {
  return state.scanned >= channels.length
}

/**
 * The channel "START WATCHING" tunes to: the one already playing when it survived the scan, so
 * accepting a scan never moves the viewer off a channel that still works, otherwise the first one
 * found.
 */
export function pickAutoTuneChannel(
  found: TVChannel[],
  selectedChannelId: string | null,
): TVChannel | null {
  if (found.length === 0) return null
  return found.find((channel) => channel.id === selectedChannelId) ?? found[0]
}
