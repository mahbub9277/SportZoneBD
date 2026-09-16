import { configureStore, createListenerMiddleware } from '@reduxjs/toolkit'
import { setupListeners } from '@reduxjs/toolkit/query'
import { emptyApi } from './api/emptyApi'
import authReducer, { logout, type AuthState } from '../features/auth/authSlice'
import notificationsReducer, { NotificationsState } from '../features/notifications/notifications.slice'
import uploadReducer, { type UploadState } from '../features/upload/uploadSlice' // Keep this line
import { themeReducer, themeListenerMiddleware } from '../features/settings/theme.slice'
import loadingReducer from '../features/loading/loadingSlice'
import {rtkQueryErrorLogger} from './api/error-logging.middleware'
import recentReducer, { recentListenerMiddleware } from '../features/recent/recent.slice'
import favoritesReducer, { favoritesListenerMiddleware } from '../features/favorites/favorites.slice'

const authCacheCleanupMiddleware = createListenerMiddleware()
authCacheCleanupMiddleware.startListening({
  actionCreator: logout,
  effect: async (_action, listenerApi) => {
    listenerApi.dispatch(emptyApi.util.resetApiState())
  },
})

export const store = configureStore({
  reducer: {
    auth: authReducer,
    notifications: notificationsReducer,
    loading: loadingReducer,
    recent: recentReducer,
    favorites: favoritesReducer,
    theme: themeReducer,
    upload: uploadReducer,
    // Add the single API slice reducer
    // All other API slices should inject into this one.
    [emptyApi.reducerPath]: emptyApi.reducer,
  },
  // Adding the api middleware enables caching, invalidation, polling,
  // and other useful features of `rtk-query`.
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware()
      .concat(emptyApi.middleware)
      .concat(themeListenerMiddleware.middleware)
      .concat(recentListenerMiddleware.middleware)
      .concat(favoritesListenerMiddleware.middleware)
      .concat(authCacheCleanupMiddleware.middleware)
      // The single middleware from emptyApi will handle all injected endpoints.
      .concat(rtkQueryErrorLogger),
})

// optional, but required for refetchOnFocus/refetchOnReconnect behaviors
setupListeners(store.dispatch)

export type RootState = ReturnType<typeof store.getState> & { auth: AuthState; notifications: NotificationsState; upload: UploadState; }
export type AppDispatch = typeof store.dispatch
