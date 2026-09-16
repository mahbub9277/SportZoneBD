import { createSlice, nanoid } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from '../../app/store'

export type NotificationType = 'info' | 'success' | 'warning' | 'error'

export interface Notification {
  id: string
  type: NotificationType
  message: string
  duration?: number // in ms
}

export interface NotificationsState {
  notifications: Notification[]
}

const initialState: NotificationsState = {
  notifications: [],
}

const notificationsSlice = createSlice({
  name: 'notifications',
  initialState,
  reducers: {
    addNotification: {
      reducer: (state, action: PayloadAction<Notification>) => {
        state.notifications.push(action.payload)
      },
      prepare: (payload: { message: string; type?: NotificationType; duration?: number }) => ({
        payload: { id: nanoid(), type: payload.type ?? 'info', ...payload },
      }),
    },
    dismissNotification: (state, action: PayloadAction<string>) => {
      state.notifications = state.notifications.filter((n) => n.id !== action.payload)
    },
  },
})

export const { addNotification, dismissNotification } = notificationsSlice.actions

export const selectNotifications = (state: RootState) => state.notifications.notifications

export default notificationsSlice.reducer