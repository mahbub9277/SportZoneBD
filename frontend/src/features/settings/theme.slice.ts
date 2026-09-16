import { createSlice, createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit'
import type { RootState } from '../../app/store'

export type Theme = 'dark' | 'light'

export interface ThemeState {
  theme: Theme
}

const getInitialTheme = (): Theme => {
  if (typeof window !== 'undefined' && window.localStorage) {
    const storedTheme = window.localStorage.getItem('theme')
    if (storedTheme === 'light' || storedTheme === 'dark') {
      return storedTheme
    }

    const userMedia = window.matchMedia('(prefers-color-scheme: light)')
    if (userMedia.matches) {
      return 'light'
    }
  }
  return 'dark'
}

const initialState: ThemeState = {
  theme: getInitialTheme(),
}

const syncTheme = (theme: Theme) => {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme
    if (theme === 'light') {
      document.documentElement.dataset.theme = 'light'
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem('theme', theme)
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
  }
}

// Apply the persisted theme before React paints the first frame.
syncTheme(initialState.theme)

const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    toggleTheme: (state) => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark'
    },
  },
})

export const { toggleTheme } = themeSlice.actions
export const selectTheme = (state: RootState) => state.theme.theme
export const themeReducer = themeSlice.reducer

// This middleware is not strictly necessary if you update localStorage in the component,
// but it's a good practice to keep side effects out of components.
// You would need to add this middleware to your store.ts file.
export const themeListenerMiddleware = createListenerMiddleware();

// Listen to both toggleTheme and the initial Redux init action
themeListenerMiddleware.startListening({
  matcher: isAnyOf(toggleTheme),
  effect: (_action, listenerApi) => {
    const state = listenerApi.getState() as RootState
    syncTheme(state.theme.theme)
  },
})