import { createSlice, createListenerMiddleware } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from '../../app/store'

// Helper to load state from localStorage safely
const loadFavoritesFromStorage = (): { favoriteMatchIds: string[]; favoriteChannelIds: string[] } => {
  try {
    if (typeof window === 'undefined') {
      return { favoriteMatchIds: [], favoriteChannelIds: [] }
    }
    const saved = window.localStorage.getItem('sportzonebd-favorites')
    if (!saved) {
      return { favoriteMatchIds: [], favoriteChannelIds: [] }
    }
    const parsed = JSON.parse(saved) as unknown
    // Ensure parsed is an object with expected properties
    if (typeof parsed === 'object' && parsed !== null && 'favoriteMatchIds' in parsed && 'favoriteChannelIds' in parsed) {
      const { favoriteMatchIds, favoriteChannelIds } = parsed as { favoriteMatchIds: unknown; favoriteChannelIds: unknown }
      return {
        favoriteMatchIds: Array.isArray(favoriteMatchIds) ? favoriteMatchIds.filter((item): item is string => typeof item === 'string') : [],
        favoriteChannelIds: Array.isArray(favoriteChannelIds) ? favoriteChannelIds.filter((item): item is string => typeof item === 'string') : [],
      }
    }
    return { favoriteMatchIds: [], favoriteChannelIds: [] }
  } catch (error) {
    console.error('Failed to load favorites from localStorage:', error)
    return { favoriteMatchIds: [], favoriteChannelIds: [] }
  }
}

export interface FavoritesState {
  favoriteMatchIds: string[]
  favoriteChannelIds: string[]
}

const initialState: FavoritesState = {
  ...loadFavoritesFromStorage(),
}

const favoritesSlice = createSlice({
  name: 'favorites',
  initialState,
  reducers: {
    toggleFavoriteMatch: (state, action: PayloadAction<string>) => {
      const matchId = action.payload
      if (state.favoriteMatchIds.includes(matchId)) {
        state.favoriteMatchIds = state.favoriteMatchIds.filter((id) => id !== matchId)
      } else {
        state.favoriteMatchIds.push(matchId)
      }
    },
    toggleFavoriteChannel: (state, action: PayloadAction<string>) => {
      const channelId = action.payload
      if (state.favoriteChannelIds.includes(channelId)) {
        state.favoriteChannelIds = state.favoriteChannelIds.filter((id) => id !== channelId)
      } else {
        state.favoriteChannelIds.push(channelId)
      }
    },
    clearAllFavorites: (state) => {
      state.favoriteMatchIds = []
      state.favoriteChannelIds = []
    },
    clearFavoriteChannels: (state) => {
      state.favoriteChannelIds = []
    },
    clearFavoriteMatches: (state) => {
      state.favoriteMatchIds = []
    },
  },
})

export const { toggleFavoriteMatch, toggleFavoriteChannel, clearAllFavorites, clearFavoriteChannels, clearFavoriteMatches } = favoritesSlice.actions

export const selectFavoriteMatchIds = (state: RootState) => state.favorites.favoriteMatchIds
export const selectFavoriteChannelIds = (state: RootState) => state.favorites.favoriteChannelIds

export const favoritesListenerMiddleware = createListenerMiddleware()
favoritesListenerMiddleware.startListening({
  matcher: (action) =>
    toggleFavoriteMatch.match(action) || toggleFavoriteChannel.match(action) || clearAllFavorites.match(action) || clearFavoriteChannels.match(action) || clearFavoriteMatches.match(action),
  effect: (_action, listenerApi) => {
    const state = listenerApi.getState() as RootState
    window.localStorage.setItem('sportzonebd-favorites', JSON.stringify({
      favoriteMatchIds: state.favorites.favoriteMatchIds,
      favoriteChannelIds: state.favorites.favoriteChannelIds,
    }))
  },
})

export default favoritesSlice.reducer