import { createListenerMiddleware, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from '../../app/store'

const MAX_RECENT_CHANNELS = 5
const STORAGE_KEY = 'sportzonebd-recents'

const readRecentChannelIdsFromStorage = (): string[] => {
  if (typeof window === 'undefined') return []

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) return []

    const parsed = JSON.parse(saved) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch (error) {
    console.error('Failed to load recents from localStorage:', error)
    return []
  }
}

const saveRecentChannelIdsToStorage = (channelIds: string[]) => {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(channelIds))
  } catch (error) {
    console.error('Failed to save recents to localStorage:', error)
  }
}

export interface RecentState {
  recentChannelIds: string[]
}

const initialState: RecentState = {
  recentChannelIds: readRecentChannelIdsFromStorage(),
}

const recentSlice = createSlice({
  name: 'recent',
  initialState,
  reducers: {
    addRecentChannel: (state, action: PayloadAction<string>) => {
      const channelId = action.payload.trim()
      if (!channelId) return

      const filteredIds = state.recentChannelIds.filter((id) => id !== channelId)
      state.recentChannelIds = [channelId, ...filteredIds].slice(0, MAX_RECENT_CHANNELS)
    },
    clearRecentChannels: (state) => {
      state.recentChannelIds = []
    },
  },
})

export const { addRecentChannel, clearRecentChannels } = recentSlice.actions

export const selectRecentChannelIds = (state: RootState) => state.recent.recentChannelIds

export const recentListenerMiddleware = createListenerMiddleware()
recentListenerMiddleware.startListening({
  matcher: (action) => addRecentChannel.match(action) || clearRecentChannels.match(action),
  effect: (_action, listenerApi) => {
    const state = listenerApi.getState() as RootState
    saveRecentChannelIdsToStorage(selectRecentChannelIds(state))
  },
})

export default recentSlice.reducer