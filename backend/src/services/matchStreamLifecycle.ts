import type { StreamStatus } from '@prisma/client'

/**
 * The stream lifecycle a match owns.
 *
 * A `Stream` belongs to exactly one match (`Stream.matchId` is a required foreign key), and the database
 * relation is `ON DELETE CASCADE`, so deleting a match deletes precisely that match's streams. A `Channel`
 * is a separate, independently managed record (`Stream.channelId … ON DELETE SET NULL`) and is never part
 * of a match's deletion.
 *
 * That is the whole lifecycle, which is why there is no per-stream delete anywhere:
 *  - a match finishes → playback stops, the stream row stays;
 *  - the match is deleted by the retention cleanup (or by an admin) → its streams go with it, atomically.
 */

/** The stream mutation applied when a match finishes. */
export interface FinishedMatchStreamUpdate {
  enabled: false
  status: Extract<StreamStatus, 'OFFLINE'>
}

/**
 * Stops playback for a match's streams without deleting them.
 *
 * The finished match stays visible for the retention window (`FINISHED_MATCH_RETENTION_MINUTES`, 30 minutes
 * by product rule), and its streams have to remain with it for that whole period: the stream is what an
 * admin inspects in Stream Management, and what a re-opened match plays again if the finish was premature.
 * Marking the row deleted here removed it from every `deletedAt: null` query roughly half an hour before the
 * lifecycle removes it, and left a match with no stream at all in the meantime.
 */
export function buildFinishedMatchStreamUpdate(): FinishedMatchStreamUpdate {
  return { enabled: false, status: 'OFFLINE' }
}
