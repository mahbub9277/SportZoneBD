import { Loader2 } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '../../lib/utils'

interface SpinnerProps {
  size?: string | number
  className?: string
  label?: string
}

export function Spinner({ size = '1.5rem', className, label = 'Loading...' }: SpinnerProps) {
  return (
    <div role="status" aria-live="polite" aria-label={label} className={cn('flex items-center justify-center', className)}>
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
      >
        <Loader2
          style={{ width: size, height: size }}
          aria-hidden="true"
          className="text-(--accent) drop-shadow-[0_0_16px_rgba(247,199,93,0.38)]"
        />
      </motion.div>
      <span className="sr-only">{label}</span>
    </div>
  )
}