import { cn } from '../../lib/utils'
import { describeUploadProgress, isDeterminateUpload, type MediaUploadProgressUpdate } from '../../utils/uploadProgress'

interface UploadProgressProps {
  update: MediaUploadProgressUpdate | null
  /** Rendered when the last upload failed, instead of the bar. */
  error?: string | null
  className?: string
}

/**
 * The progress indicator every media form shows while a file is on its way to storage.
 *
 * The bar is determinate only while the browser is really sending bytes; the server-side stages are
 * indeterminate, so the interface never claims a percentage it cannot measure, and never reaches "done"
 * before the asset is actually verified.
 */
export function UploadProgress({ update, error, className }: UploadProgressProps) {
  if (error) {
    return (
      <p className={cn('text-xs font-medium text-rose-400', className)} role="alert">
        Upload failed: {error}
      </p>
    )
  }

  if (!update) return null

  const { stageLabel, batchLabel, percentLabel } = describeUploadProgress(update)
  const determinate = isDeterminateUpload(update)

  return (
    <div className={cn('w-full space-y-1.5', className)}>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-(--surface-soft) ring-1 ring-(--border)"
        role="progressbar"
        aria-label={`Uploading ${update.fileName}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={determinate ? update.percent : undefined}
        aria-valuetext={percentLabel ?? stageLabel}
      >
        {determinate ? (
          <div
            className="h-full rounded-full bg-linear-to-r from-(--accent) to-(--accent-strong) transition-[width] duration-200 ease-out"
            style={{ width: `${update.percent}%` }}
          />
        ) : (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-linear-to-r from-(--accent)/70 to-(--accent-strong)/70" />
        )}
      </div>
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-brand-text-muted" aria-live="polite">
        <span className="font-medium text-brand-text-secondary">{stageLabel}</span>
        {percentLabel ? <span className="font-semibold text-(--accent)">{percentLabel}</span> : null}
        {batchLabel ? <span>{batchLabel}</span> : null}
        <span className="max-w-48 truncate" title={update.fileName}>{update.fileName}</span>
      </p>
    </div>
  )
}
