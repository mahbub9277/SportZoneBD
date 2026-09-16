export type NotificationType = 'success' | 'warning' | 'error' | 'info' | 'default'

export interface Notification {
  id: string
  userId: string
  title: string
  body: string
  link?: string | null
  type: NotificationType
  channel: string
  isRead: boolean
  createdAt: string
  match?: {
    id: string
    homeTeamName: string | null
    awayTeamName: string | null
    homeTeamLogo: string | null
    awayTeamLogo: string | null
  }
}