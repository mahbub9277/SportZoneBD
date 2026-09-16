/**
 * SocketIOListener - A component that initializes Socket.IO listeners
 * for real-time admin resource updates
 * 
 * This component should be placed early in the React tree (in AppProvider)
 * to ensure Socket.IO listeners are active for all admin features
 */
import { useAdminSocketListener } from '@/hooks/useAdminSocket'

export function SocketIOListener() {
  // Initialize Socket.IO listeners
  useAdminSocketListener()
  
  // This component doesn't render anything, just sets up listeners
  return null
}
