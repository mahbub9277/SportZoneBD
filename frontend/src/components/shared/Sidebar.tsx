import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppSelector } from '../../app/hooks'
import { selectIsAuthenticated } from '../../features/auth/auth.slice'
import { useLogoutMutation } from '../../features/auth/auth.api.ts'
import { SidebarHeader } from './sidebar/SidebarHeader'
import { SidebarNav } from './sidebar/SidebarNav'

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const isAuthenticated = useAppSelector(selectIsAuthenticated)
  const [logout] = useLogoutMutation()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const handleLogout = async () => {
    try {
      await logout().unwrap()
      navigate('/login')
    } catch (error) {
      console.error('Failed to logout:', error)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="sidebar-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="fixed inset-0 z-40 bg-black/60 xl:hidden"
            onClick={onClose}
          />
          <motion.aside
            key="sidebar"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="fixed left-0 top-0 z-40 h-full w-[88vw] max-w-90 border-r border-border/10 bg-surface/90 shadow-sidebar backdrop-blur-2xl xl:hidden"
          >
            <div className="flex h-full max-h-screen flex-col gap-5">
              <div className="flex items-center justify-between px-2 pt-3">
                <div className="flex-1">
                  <SidebarHeader />
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-border/70 bg-surface-soft/80 text-text-primary shadow-sm transition hover:border-accent/40 hover:text-accent"
                  aria-label="Close menu"
                >
                  <motion.div whileHover={{ rotate: 90 }} whileTap={{ scale: 0.9 }} className="flex items-center justify-center">
                    <X className="h-3 w-3" />
                  </motion.div>
                </button>
              </div>
              <div className="flex-1 overflow-auto px-4 py-3">
                <SidebarNav isAuthenticated={isAuthenticated} onLogout={handleLogout} onNavigate={onClose} />
              </div>
            </div>
          </motion.aside>
        </>
      )}
      {/* Static sidebar for larger screens */}
      <aside className="hidden h-full w-95 flex-col border-r border-border/10 bg-surface/90 shadow-sidebar backdrop-blur-2xl xl:flex">
        <SidebarHeader />
        <div className="flex-1 overflow-auto px-4 py-3">
          <SidebarNav isAuthenticated={isAuthenticated} onLogout={handleLogout} />
        </div>
      </aside>
    </AnimatePresence>
  )
}
