import { useNavigation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'

interface GlobalLoadingIndicatorProps {
  force?: boolean
}

export function GlobalLoadingIndicator({ force = false }: GlobalLoadingIndicatorProps) {
  const navigation = useNavigation()

  // Background API requests use local loading states; this bar is reserved for navigation.
  const isRouterLoading = navigation.state === 'loading' || navigation.state === 'submitting'
  const isLoading = force || isRouterLoading

  return (
    <AnimatePresence>
      {isLoading && (
        <motion.div
          role="progressbar"
          aria-label="Loading page content"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={90}
          aria-busy="true"
          className="pointer-events-none fixed top-0 left-0 right-0 h-1 z-9999"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.2, delay: 0.12 } }}
          exit={{ opacity: 0, transition: { duration: 0.5, delay: 0.3 } }}
        >
          <motion.div
            className="h-full bg-linear-to-r from-brand-accent via-blue-400 to-brand-accent bg-size-[200%_200%]"
            initial={{ width: '0%' }}
            animate={{
              width: '90%',
              backgroundPosition: ['0% 50%', '200% 50%'],
            }}
            transition={{
              // Use a spring for a more natural feel, or a short ease-out duration
              width: { type: 'spring', stiffness: 100, damping: 20, mass: 1 },
              // Keep the shimmering effect for the background
              backgroundPosition: { duration: 2, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse' },
            }}
          />
          <span className="sr-only">Loading...</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}