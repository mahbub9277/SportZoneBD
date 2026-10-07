import { createListenerMiddleware, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from '../../app/store'

// Only the channel ids are stored: the pinned state is restored by matching them against the channel
// data the page already fetches, so no channel detail is duplicated in browser storage.
const STORAGE_KEY = 'sportzonebd-pinned-channels'

const readPinnedChannelIdsFromStorage = (): string[] => {
  if (typeof window === 'undefined') return []

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) return []

    const parsed = JSON.parse(saved) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch (error) {
    console.error('Failed to load pinned channels from localStorage:', error)
    return []
  }
}

const savePinnedChannelIdsToStorage = (channelIds: string[]) => {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(channelIds))
  } catch (error) {
    console.error('Failed to save pinned channels to localStorage:', error)
  }
}

export interface PinnedChannelsState {
  pinnedChannelIds: string[]
}

const initialState: PinnedChannelsState = {
  pinnedChannelIds: readPinnedChannelIdsFromStorage(),
}

const pinnedChannelsSlice = createSlice({
  name: 'pinnedChannels',
  initialState,
  reducers: {
    /** Pins the channel when it is not pinned yet and unpins it otherwise. */
    togglePinnedChannel: (state, action: PayloadAction<string>) => {
      const channelId = action.payload.trim()
      if (!channelId) return

      state.pinnedChannelIds = state.pinnedChannelIds.includes(channelId)
        ? state.pinnedChannelIds.filter((id) => id !== channelId)
        : [...state.pinnedChannelIds, channelId]
    },
    clearPinnedChannels: (state) => {
      state.pinnedChannelIds = []
    },
  },
})

export const { togglePinnedChannel, clearPinnedChannels } = pinnedChannelsSlice.actions

export const selectPinnedChannelIds = (state: RootState) => state.pinnedChannels.pinnedChannelIds

export const pinnedChannelsListenerMiddleware = createListenerMiddleware()
pinnedChannelsListenerMiddleware.startListening({
  matcher: (action) => togglePinnedChannel.match(action) || clearPinnedChannels.match(action),
  effect: (_action, listenerApi) => {
    const state = listenerApi.getState() as RootState
    savePinnedChannelIdsToStorage(selectPinnedChannelIds(state))
  },
})

export default pinnedChannelsSlice.reducer
