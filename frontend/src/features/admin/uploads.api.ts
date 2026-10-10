import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse } from '../../app/api/types'
import { toTransferPercent, type MediaUploadProgressUpdate } from '../../utils/uploadProgress'

export interface UploadedFile {
  fileName: string
  url: string
  publicId: string
  mimeType: string
  size: number
}

export interface UploadResponse {
  uploads: UploadedFile[]
  failedUploads: string[]
}

type UploadPurpose =
  | 'highlight-image'
  | 'highlight-video'
  | 'banner-image'
  | 'banner-video'
  | 'banner-poster'
  | 'advertisement-image'
  | 'event-logo'
  | 'event-banner'
  | 'popup-image'
  | 'team-logo'
  | 'stream-logo'
  | 'channel-logo'
  | 'channel-category-logo'
  | 'match-prestart-video'

interface UploadAuthorization {
  asset_folder: string
  public_id: string
  timestamp: number
  signature: string
  apiKey: string
  cloudName: string
  resourceType: 'image' | 'video'
  maxBytes: number
}

interface CloudinaryUploadResult {
  public_id: string
  version: number
  signature: string
}

/**
 * The stages a direct upload really goes through are defined (with their captions) in
 * `utils/uploadProgress.ts`, so the progress maths and wording live in one testable place.
 */
export type { MediaUploadProgressUpdate, MediaUploadStage } from '../../utils/uploadProgress'

export interface UploadFilesArgs {
  files: File[]
  folder?: string
  mediaType?: 'BANNER' | 'LOGO' | 'VIDEO'
  /** Called as the upload advances; the caller owns the UI state. */
  onProgress?: (update: MediaUploadProgressUpdate) => void
}

const CHUNKED_UPLOAD_THRESHOLD = 100 * 1024 * 1024
const UPLOAD_CHUNK_BYTES = 20 * 1024 * 1024

function getUploadPurpose(file: File, folder: string | undefined, mediaType: 'BANNER' | 'LOGO' | 'VIDEO' | undefined): UploadPurpose | null {
  const isVideo = file.type.startsWith('video/')
  switch (folder) {
    case 'sportzone/highlights': return isVideo ? 'highlight-video' : 'highlight-image'
    case 'sportzone/banners': return isVideo ? 'banner-video' : 'banner-image'
    case 'sportzone/advertisements': return 'advertisement-image'
    case 'sportzone/events': return mediaType === 'BANNER' ? 'event-banner' : 'event-logo'
    case 'sportzone/popups': return 'popup-image'
    case 'sportzone/team-logos': return 'team-logo'
    case 'sportzone/stream-logos': return 'stream-logo'
    case 'sportzone/channels': return 'channel-logo'
    case 'sportzone/channel-categories': return 'channel-category-logo'
    case 'sportzone/match-prestart': return 'match-prestart-video'
    default: return null
  }
}

function uploadCloudinaryChunk(
  file: File,
  authorization: UploadAuthorization,
  start: number,
  end: number,
  uploadId: string,
  signal: AbortSignal,
  onTransfer?: (loadedBytes: number) => void,
): Promise<CloudinaryUploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const formData = new FormData()
    formData.append('file', file.slice(start, end + 1), file.name)
    formData.append('asset_folder', authorization.asset_folder)
    formData.append('public_id', authorization.public_id)
    formData.append('timestamp', String(authorization.timestamp))
    formData.append('api_key', authorization.apiKey)
    formData.append('signature', authorization.signature)

    xhr.open('POST', `https://api.cloudinary.com/v1_1/${authorization.cloudName}/${authorization.resourceType}/upload`)
    const chunked = file.size > CHUNKED_UPLOAD_THRESHOLD
    if (chunked) {
      xhr.setRequestHeader('X-Unique-Upload-Id', uploadId)
      xhr.setRequestHeader('Content-Range', `bytes ${start}-${end}/${file.size}`)
    }

    // Real byte-level progress of this request. `event.loaded` counts the body of this request only, so
    // the chunk offset is added back to report progress across the whole file.
    if (onTransfer) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onTransfer(start + event.loaded)
      }
    }

    const abortUpload = () => xhr.abort()
    signal.addEventListener('abort', abortUpload, { once: true })
    xhr.onload = () => {
      signal.removeEventListener('abort', abortUpload)
      let response: CloudinaryUploadResult & { error?: { message?: string } }
      try {
        response = JSON.parse(xhr.responseText)
      } catch {
        reject(new Error('Cloudinary returned an invalid upload response.'))
        return
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(response.error?.message || `Cloudinary upload failed (${xhr.status}).`))
        return
      }
      resolve(response)
    }
    xhr.onerror = () => {
      signal.removeEventListener('abort', abortUpload)
      reject(new Error('Cloudinary upload failed because of a network error.'))
    }
    xhr.onabort = () => {
      signal.removeEventListener('abort', abortUpload)
      reject(new Error('Cloudinary upload was cancelled.'))
    }
    xhr.send(formData)
  })
}

async function uploadCloudinaryFile(
  file: File,
  authorization: UploadAuthorization,
  signal: AbortSignal,
  onTransfer?: (loadedBytes: number) => void,
): Promise<CloudinaryUploadResult> {
  const uploadId = crypto.randomUUID()
  if (file.size <= CHUNKED_UPLOAD_THRESHOLD) {
    return uploadCloudinaryChunk(file, authorization, 0, file.size - 1, uploadId, signal, onTransfer)
  }

  let result: CloudinaryUploadResult | null = null
  for (let start = 0; start < file.size; start += UPLOAD_CHUNK_BYTES) {
    const end = Math.min(start + UPLOAD_CHUNK_BYTES, file.size) - 1
    result = await uploadCloudinaryChunk(file, authorization, start, end, uploadId, signal, onTransfer)
  }
  if (!result) throw new Error('Cloudinary did not return a completed upload.')
  return result
}

function toCustomError(error: unknown) {
  return {
    status: 'CUSTOM_ERROR' as const,
    error: error instanceof Error ? error.message : 'Cloudinary upload failed.',
  }
}

export const uploadsApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    uploadFiles: builder.mutation<UploadResponse, UploadFilesArgs>({
      async queryFn({ files, folder, mediaType, onProgress }, api, _extraOptions, baseQuery) {
        if (!files.length || files.length > 10) return { error: toCustomError(new Error('Select between one and ten files.')) }
        const uploads: UploadedFile[] = []
        const failedUploads: string[] = []

        for (const [index, file] of files.entries()) {
          const position = { fileName: file.name, fileIndex: index + 1, fileCount: files.length }
          const purpose = getUploadPurpose(file, folder ?? '', mediaType)
          if (!purpose) {
            failedUploads.push(`${file.name}: This upload purpose is not supported.`)
            continue
          }

          onProgress?.({ ...position, stage: 'preparing', percent: 0 })
          const signatureResponse = await baseQuery({
            url: '/admin/uploads/cloudinary/signature',
            method: 'POST',
            body: { purpose, fileName: file.name, fileSize: file.size, mimeType: file.type },
          })
          if (signatureResponse.error) return { error: signatureResponse.error }

          try {
            const authorization = unwrapApiResponse<UploadAuthorization>(signatureResponse.data as ApiResponse<UploadAuthorization>)
            if (!authorization || authorization.maxBytes < file.size) {
              throw new Error('Selected file exceeds the authorized upload size.')
            }

            // The percentage is reported on change only: `progress` fires far more often than the value
            // actually moves, and every report is a React state update.
            let reportedPercent = -1
            const cloudinaryResult = await uploadCloudinaryFile(file, authorization, api.signal, (loadedBytes) => {
              const percent = toTransferPercent(loadedBytes, file.size)
              if (percent === reportedPercent) return
              reportedPercent = percent
              onProgress?.({ ...position, stage: 'uploading', percent })
            })
            onProgress?.({ ...position, stage: 'processing', percent: 100 })
            const completionResponse = await baseQuery({
              url: '/admin/uploads/cloudinary/complete',
              method: 'POST',
              body: {
                purpose,
                fileName: file.name,
                mimeType: file.type,
                publicId: cloudinaryResult.public_id,
                version: cloudinaryResult.version,
                signature: cloudinaryResult.signature,
              },
            })
            if (completionResponse.error) {
              await baseQuery({ url: '/admin/uploads/file', method: 'DELETE', body: { publicId: cloudinaryResult.public_id } })
              failedUploads.push(`${file.name}: ${String((completionResponse.error as { error?: string }).error ?? 'Upload verification failed.')}`)
              continue
            }
            const uploaded = unwrapApiResponse<UploadedFile>(completionResponse.data as ApiResponse<UploadedFile>)
            if (!uploaded?.url || !uploaded.publicId) throw new Error('Verified Cloudinary asset metadata was incomplete.')
            uploads.push(uploaded)
            onProgress?.({ ...position, stage: 'done', percent: 100 })
          } catch (error) {
            failedUploads.push(`${file.name}: ${error instanceof Error ? error.message : 'Upload failed.'}`)
          }
        }

        if (uploads.length === 0 && failedUploads.length > 0) return { error: toCustomError(new Error(failedUploads.join(' '))) }
        return { data: { uploads, failedUploads } }
      },
    }),
    deleteUploadedFile: builder.mutation<void, string>({
      query: (publicId) => ({
        url: '/admin/uploads/file',
        method: 'DELETE',
        body: { publicId },
      }),
    }),
  }),
  overrideExisting: false,
})

export const { useUploadFilesMutation, useDeleteUploadedFileMutation } = uploadsApi
