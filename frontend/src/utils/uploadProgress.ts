/**
 * Upload progress: the parts that are pure, so the maths and the wording can be tested without a browser.
 *
 * A direct-to-Cloudinary upload has two genuinely different phases, and they are reported separately
 * because they measure different things:
 *
 * - `uploading` is the file's bytes leaving the browser. This is the only phase that can be a real
 *   percentage, and it is what the byte-level `progress` event of the request reports.
 * - `processing` is everything after the bytes are sent: Cloudinary stores the asset and the backend
 *   verifies its metadata. No byte percentage can describe it, so the UI shows an indeterminate stage
 *   instead of pretending to know how far along it is.
 *
 * `done` is only reported once the asset is verified and usable, which is what stops the interface from
 * claiming success at 100% while the server is still working.
 */

export type MediaUploadStage = 'preparing' | 'uploading' | 'processing' | 'done'

export interface MediaUploadProgressUpdate {
  stage: MediaUploadStage
  /** Transfer completion of this file, 0-100. Only meaningful while the stage is `uploading`. */
  percent: number
  fileName: string
  /** 1-based position of this file in the requested batch. */
  fileIndex: number
  fileCount: number
}

/**
 * Transfer completion of a file, clamped so a rounding artefact can never report 101% or a negative
 * value, and so a zero-length file (which the upload policies reject anyway) cannot divide by zero.
 */
export function toTransferPercent(loadedBytes: number, totalBytes: number): number {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return 0
  if (!Number.isFinite(loadedBytes) || loadedBytes <= 0) return 0
  return Math.min(100, Math.round((loadedBytes / totalBytes) * 100))
}

/** Whether the bar shows a real percentage (`true`) or an indeterminate stage (`false`). */
export function isDeterminateUpload(update: MediaUploadProgressUpdate | null | undefined): boolean {
  return update?.stage === 'uploading'
}

const STAGE_LABELS: Record<MediaUploadStage, string> = {
  preparing: 'Preparing upload…',
  uploading: 'Uploading',
  processing: 'Processing on server…',
  done: 'Upload complete',
}

export interface UploadProgressCaption {
  /** Short stage wording for the caption line. */
  stageLabel: string
  /** `"2 of 3"` when the request carries several files, otherwise null. */
  batchLabel: string | null
  /** Percentage to render next to the bar, or null when the stage cannot be measured. */
  percentLabel: string | null
}

/** The caption a progress indicator shows for an update, kept in one place so every upload reads alike. */
export function describeUploadProgress(update: MediaUploadProgressUpdate): UploadProgressCaption {
  return {
    stageLabel: STAGE_LABELS[update.stage] ?? STAGE_LABELS.preparing,
    batchLabel: update.fileCount > 1 ? `${update.fileIndex} of ${update.fileCount}` : null,
    percentLabel: update.stage === 'uploading' ? `${update.percent}%` : null,
  }
}
