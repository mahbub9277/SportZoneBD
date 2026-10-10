import { useCallback, useEffect, useRef, useState } from 'react'
import { useUploadFilesMutation } from '../features/admin/uploads.api'
import type { MediaUploadProgressUpdate } from '../utils/uploadProgress'

/**
 * Upload state for a single form or dropzone.
 *
 * Every media form needed the same three things — a real progress value while the file is being sent, a
 * guard against submitting the same upload twice, and a clean reset before the next attempt — so they
 * live here instead of being re-implemented per page. The hook owns the mutation so a caller keeps its
 * existing `isUploading` behaviour: the flag stays true for the whole operation, not just the transfer.
 */
export interface MediaUploadProgressState {
  /** True from the first byte until the upload either succeeds or fails. */
  active: boolean
  update: MediaUploadProgressUpdate | null
  /** Set when the last attempt failed, so a form can show a recoverable message. */
  error: string | null
}

const IDLE_PROGRESS: MediaUploadProgressState = { active: false, update: null, error: null }

export function useMediaUploadProgress() {
  const [uploadFiles, { isLoading }] = useUploadFilesMutation()
  const [progress, setProgress] = useState<MediaUploadProgressState>(IDLE_PROGRESS)
  const isMounted = useRef(true)
  // A form can legitimately run two uploads at once (two team logos, for example), so the active flag
  // counts them instead of letting the first one to finish clear it while the other is still running.
  const activeUploads = useRef(0)

  useEffect(() => () => {
    // A component that unmounts mid-upload must not be sent more progress updates.
    isMounted.current = false
  }, [])

  const upload = useCallback(async (args: Parameters<typeof uploadFiles>[0]) => {
    activeUploads.current += 1
    setProgress({ active: true, update: null, error: null })
    try {
      return await uploadFiles({
        ...args,
        onProgress: (update) => {
          if (isMounted.current) setProgress((current) => ({ ...current, active: true, update }))
        },
      }).unwrap()
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : typeof (error as { error?: unknown })?.error === 'string'
          ? String((error as { error: string }).error)
          : 'Upload failed.'
      if (isMounted.current) setProgress({ active: true, update: null, error: message })
      throw error
    } finally {
      activeUploads.current -= 1
      if (isMounted.current) setProgress((current) => ({ ...current, active: activeUploads.current > 0 }))
    }
  }, [uploadFiles])

  const reset = useCallback(() => setProgress(IDLE_PROGRESS), [])

  return {
    upload,
    progress,
    /** Clears a finished attempt's progress or error, for a form that replaced the selected file. */
    reset,
    /** True while the request or the transfer is running, so callers never double-submit. */
    isUploading: isLoading || progress.active,
  }
}
