import { useCallback, useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { cva } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const backToTopButtonVariants = cva(
  'fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full border border-accent/30 bg-surface-strong/80 text-accent shadow-lg shadow-accent/10 backdrop-blur-lg transition-all duration-300 hover:-translate-y-1 hover:bg-accent hover:text-black hover:shadow-xl hover:shadow-back-to-top-hover focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface',
)

interface BackToTopButtonProps {
  className?: string
  scrollThreshold?: number
  scrollContainerRef?: React.RefObject<HTMLElement | null>
}

export function BackToTopButton({ className, scrollThreshold = 400, scrollContainerRef }: BackToTopButtonProps) {
  const [isVisible, setIsVisible] = useState(false)

  const getScrollTop = useCallback(() => {
    const container = scrollContainerRef?.current
    return container ? container.scrollTop : window.scrollY
  }, [scrollContainerRef])

  useEffect(() => {
    const container = scrollContainerRef?.current ?? window

    const toggleVisibility = () => {
      setIsVisible(getScrollTop() > scrollThreshold)
    }

    toggleVisibility()
    container.addEventListener('scroll', toggleVisibility, { passive: true })
    return () => container.removeEventListener('scroll', toggleVisibility)
  }, [getScrollTop, scrollThreshold, scrollContainerRef])

  const scrollToTop = () => {
    const container = scrollContainerRef?.current ?? window
    container.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.button
          onClick={scrollToTop}
          initial={{ opacity: 0, y: 20, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.9 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className={cn(backToTopButtonVariants(), className)}
          aria-label="Go to top"
          title="Go to top"
        >
          <ArrowUp className="h-6 w-6" />
        </motion.button>
      )}
    </AnimatePresence>
  )
}