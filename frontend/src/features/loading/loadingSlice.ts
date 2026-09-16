import { createSelector, createSlice, isPending, isFulfilled, isRejected, type AnyAction, isAnyOf } from '@reduxjs/toolkit'
import type { RootState } from '../../app/store'

export interface LoadingState {
  pendingRequests: Record<string, boolean>
}

const initialState: LoadingState = {
  pendingRequests: {},
}

/**
 * A custom matcher that checks if an action should affect the global loading state.
 * It ignores actions that have `meta.arg.showGlobalLoader === false`.
 * @param action - The Redux action to check.
 * @returns True if the action should be tracked for loading.
 */
const isTrackableAction = (action: AnyAction): boolean => {
  return action.meta?.arg?.showGlobalLoader !== false
}

const loadingSlice = createSlice({
  name: 'loading',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    // Match pending actions that are trackable
    builder.addMatcher(
      (action): action is AnyAction => isPending(action) && isTrackableAction(action),
      (state, action) => {
        state.pendingRequests[action.meta.requestId] = true
      },
    )
    // Match fulfilled or rejected actions that are trackable
    builder.addMatcher(isAnyOf(isFulfilled, isRejected), (state, action) => {
      if (state.pendingRequests[action.meta.requestId]) {
        delete state.pendingRequests[action.meta.requestId]
      }
    })
  },
})

const selectPendingRequests = (state: RootState) => state.loading.pendingRequests

export const selectIsLoading = createSelector(
  [selectPendingRequests],
  (pendingRequests) => Object.keys(pendingRequests).length > 0,
)
export default loadingSlice.reducer