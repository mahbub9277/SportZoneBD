import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from '../../app/store'

export interface UploadItem {
  id: string; // A unique ID for the upload, e.g., a timestamp or a generated UUID
  fileName: string;
  status: 'uploading' | 'success' | 'error';
  progress: number;
  error: string | null;
}

export interface UploadState {
  uploads: Record<string, UploadItem>;
}

const initialState: UploadState = {
  uploads: {},
}

const uploadSlice = createSlice({
  name: 'upload',
  initialState,
  reducers: {
    addUpload: (state, action: PayloadAction<{ id: string; fileName: string }>) => {
      const { id, fileName } = action.payload;
      state.uploads[id] = {
        id,
        fileName,
        status: 'uploading',
        progress: 0,
        error: null,
      };
    },
    setUploadProgress: (state, action: PayloadAction<{ id: string; progress: number }>) => {
      const { id, progress } = action.payload;
      const upload = state.uploads[id];
      if (upload && upload.status === 'uploading') {
        upload.progress = progress;
      }
    },
    setUploadSuccess: (state, action: PayloadAction<{ id: string }>) => {
      const upload = state.uploads[action.payload.id];
      if (upload) {
        upload.status = 'success';
        upload.progress = 100;
      }
    },
    setUploadError: (state, action: PayloadAction<{ id: string; error: string }>) => {
      const { id, error } = action.payload;
      const upload = state.uploads[id];
      if (upload) {
        upload.status = 'error';
        upload.error = error;
      }
    },
    removeUpload: (state, action: PayloadAction<{ id: string }>) => {
      delete state.uploads[action.payload.id];
    },
    clearUploads: (state) => {
      state.uploads = {};
    },
  },
})

export const { addUpload, setUploadProgress, setUploadSuccess, setUploadError, removeUpload, clearUploads } = uploadSlice.actions

export const selectAllUploads = (state: RootState) => Object.values(state.upload.uploads);
export const selectUploadById = (id: string) => (state: RootState) => state.upload.uploads[id];
export const selectIsUploading = (state: RootState) => Object.values(state.upload.uploads).some(upload => upload.status === 'uploading');
export const selectUploadProgress = (state: RootState) => {
  const uploads = Object.values(state.upload.uploads);
  if (uploads.length === 0) return 0;

  const uploadingUploads = uploads.filter(upload => upload.status === 'uploading');
  if (uploadingUploads.length === 0) return 100;

  const averageProgress = uploadingUploads.reduce((sum, upload) => sum + upload.progress, 0) / uploadingUploads.length;
  return Math.round(averageProgress);
};

export default uploadSlice.reducer