import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse } from '../../app/api/types'

export interface UploadedFile {
  fileName: string
  url: string
  publicId: string
  mimeType: string
  size: number
}

interface UploadResponse {
  uploads: UploadedFile[]
  failedUploads: string[]
}

export const uploadsApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    uploadFiles: builder.mutation<UploadResponse, { files: File[]; folder?: string; mediaType?: 'BANNER' | 'LOGO' | 'VIDEO' }>({
      query: ({ files, folder, mediaType }) => {
        const formData = new FormData()
        files.forEach((file) => formData.append('files', file))
        if (folder) formData.append('folder', folder)
        if (mediaType) formData.append('mediaType', mediaType)
        const query = mediaType ? `?mediaType=${encodeURIComponent(mediaType)}` : ''
        return { url: `/admin/uploads/file${query}`, method: 'POST', body: formData }
      },
      transformResponse: (response: ApiResponse<UploadResponse>) => unwrapApiResponse(response),
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
