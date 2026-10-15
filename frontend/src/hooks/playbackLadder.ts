/**
 * The source-selection contract shared by the player and the manifest proxy.
 *
 * A stream record is played in one deterministic, bounded order:
 *
 *  1. the source the caller asked for — `primary`, or `backup` when the viewer picked the stream's backup;
 *  2. the record's *other* source, because the proxy decides what `type=backup` means from the database;
 *  3. the same URL fetched directly instead of through the proxy, which is a different transport and not a
 *     repeat of an attempt that already failed;
 *  4. nothing left — the player reports a terminal error instead of retrying forever.
 *
 * Every step changes the transport, so no attempt can re-request exactly what just failed, and a source
 * only ever moves forward: once the backup has been selected it is never selected again.
 */
export type PlaybackAttempt = 'backup' | 'direct'

export interface PlaybackAttemptState {
  /** The stream record id. Without one there is no proxy, so no other source to move to. */
  streamId?: string | null
  /** Whether the current attempt is already the stream's backup source. */
  usedBackup: boolean
  /** Whether the current attempt already bypasses the proxy. */
  forceDirectUrl: boolean
  /** Whether a URL exists at all to fetch directly. */
  hasUrl: boolean
}

export function nextPlaybackAttempt(state: PlaybackAttemptState): PlaybackAttempt | null {
  if (!state.streamId) return null

  if (!state.usedBackup && !state.forceDirectUrl) return 'backup'
  if (!state.forceDirectUrl && state.hasUrl) return 'direct'
  return null
}
