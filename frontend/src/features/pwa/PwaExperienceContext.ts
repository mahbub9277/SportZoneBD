import { createContext, useContext } from 'react'

export type PwaUpdateStatus = 'idle' | 'checking' | 'available' | 'up-to-date' | 'error' | 'updating'

export interface PwaExperience {
  isOffline: boolean
  isInstalled: boolean
  canInstall: boolean
  updateStatus: PwaUpdateStatus
  installApp: () => Promise<void>
  checkForUpdates: () => Promise<void>
  applyUpdate: () => void
  dismissUpdate: () => void
}

export const PwaExperienceContext = createContext<PwaExperience | null>(null)

export function usePwaExperience(): PwaExperience {
  const context = useContext(PwaExperienceContext)
  if (!context) throw new Error('usePwaExperience must be used inside PwaExperienceContext.Provider')
  return context
}