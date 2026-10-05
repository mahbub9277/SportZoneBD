import { createSlice, createListenerMiddleware } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from '../../app/store'

// Helper to load state from localStorage safely
const FAVORITES_STORAGE_KEY = 'sportzonebd-favorites'

// Legacy payloads also stored favoriteMatchIds; match favourites no longer exist, so only channel ids are read.
const loadFavoritesFromStorage = (): { favoriteChannelIds: string[] } => {
  try {
    if (typeof window === 'undefined') {
      return { favoriteChannelIds: [] }
    }
    const saved = window.localStorage.getItem(FAVORITES_STORAGE_KEY)
    if (!saved) {
      return { favoriteChannelIds: [] }
    }
    const parsed = JSON.parse(saved) as unknown
    // Ensure parsed is an object with the expected property
    if (typeof parsed === 'object' && parsed !== null && 'favoriteChannelIds' in parsed) {
      const { favoriteChannelIds } = parsed as { favoriteChannelIds: unknown }
      return {
        favoriteChannelIds: Array.isArray(favoriteChannelIds) ? favoriteChannelIds.filter((item): item is string => typeof item === 'string') : [],
      }
    }
    return { favoriteChannelIds: [] }
  } catch (error) {
    console.error('Failed to load favorites from localStorage:', error)
    return { favoriteChannelIds: [] }
  }
}

export interface FavoritesState {
  favoriteChannelIds: string[]
}

const initialState: FavoritesState = {
  ...loadFavoritesFromStorage(),
}

const favoritesSlice = createSlice({
  name: 'favorites',
  initialState,
  reducers: {
    toggleFavoriteChannel: (state, action: PayloadAction<string>) => {
      const channelId = action.payload
      if (state.favoriteChannelIds.includes(channelId)) {
        state.favoriteChannelIds = state.favoriteChannelIds.filter((id) => id !== channelId)
      } else {
        state.favoriteChannelIds.push(channelId)
      }
    },
    clearFavoriteChannels: (state) => {
      state.favoriteChannelIds = []
    },
  },
})

export const { toggleFavoriteChannel, clearFavoriteChannels } = favoritesSlice.actions

export const selectFavoriteChannelIds = (state: RootState) => state.favorites.favoriteChannelIds

export const favoritesListenerMiddleware = createListenerMiddleware()
favoritesListenerMiddleware.startListening({
  matcher: (action) => toggleFavoriteChannel.match(action) || clearFavoriteChannels.match(action),
  effect: (_action, listenerApi) => {
    const state = listenerApi.getState() as RootState
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify({
      favoriteChannelIds: state.favorites.favoriteChannelIds,
    }))
  },
})

export default favoritesSlice.reducer