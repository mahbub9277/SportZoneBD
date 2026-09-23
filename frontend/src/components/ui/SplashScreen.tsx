import { useMemo } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { buildCloudinaryUrl } from '../../utils/cloudinary'
import localLogo from '../../assets/site.logo.webp'

interface SplashScreenProps {
  isDataLoading: boolean
  splashLogo?: string
  channelName?: string
  channelTagline?: string
  variant?: 'standard' | 'premium'
}

export function SplashScreen({
  isDataLoading,
  splashLogo,
  channelName = 'SportZoneBD',
  channelTagline = 'Live sports, instant access',
  variant = 'standard',
}: SplashScreenProps) {
  const shouldReduceMotion = useReducedMotion()
  const isPremium = variant === 'premium'

  const logoSource = useMemo(
    () => (
      splashLogo
        ? buildCloudinaryUrl(splashLogo, { width: 96, height: 96, crop: 'fill', gravity: 'auto' })
        : localLogo
    ),
    [splashLogo],
  )

  const badgeText = isPremium ? 'Premium Experience' : 'Standard Experience'
  const backdropStyle = useMemo(
    () => ({
      background: isPremium
        ? 'radial-gradient(circle at top, rgba(34,211,238,0.16), transparent 38%), linear-gradient(135deg, rgba(12,18,55,0.98) 0%, rgba(18,40,91,0.96) 42%, rgba(8,15,32,1) 100%)'
        : 'radial-gradient(circle at top, rgba(59,130,246,0.18), transparent 42%), linear-gradient(135deg, #0f172a 0%, #111827 44%, #1e293b 100%)',
    }),
    [isPremium],
  )

  const shellClassName = useMemo(
    () => (
      'relative flex w-full max-w-md flex-col items-center rounded-[28px] border p-8 text-center shadow-[0_0_80px_rgba(4,116,196,0.16)] backdrop-blur-xl ' +
      (isPremium ? 'border-cyan-400/20 bg-slate-950/80' : 'border-white/10 bg-slate-900/75')
    ),
    [isPremium],
  )

  const badgeClassName = useMemo(
    () => (
      'mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] ' +
      (isPremium ? 'border border-cyan-400/30 bg-cyan-500/15 text-cyan-100' : 'border border-white/10 bg-white/10 text-cyan-200')
    ),
    [isPremium],
  )

  const logoClassName = useMemo(
    () => (
      'relative mb-6 flex h-20 w-20 items-center justify-center overflow-hidden rounded-full p-3 shadow-[0_18px_70px_rgba(74,222,128,0.18)] ' +
      (isPremium ? 'bg-linear-to-br from-cyan-500 to-violet-700' : 'border border-white/10 bg-white/8')
    ),
    [isPremium],
  )

  const isVisible = isDataLoading

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={`Loading ${channelName}`}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.5, ease: 'easeInOut' }}
          className="fixed inset-0 z-9999 flex items-center justify-center overflow-hidden bg-slate-950"
        >
          <div className="absolute inset-0" style={backdropStyle} />

          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.7, ease: 'easeOut', delay: shouldReduceMotion ? 0 : 0.15 }}
            className={shellClassName}
          >
            <div className="sr-only" role="status" aria-live="polite">
              Loading application, please wait.
            </div>

            <div className="absolute inset-0 rounded-[28px] border border-white/10" />

            <div className={logoClassName}>
              <img
                src={logoSource}
                alt={`${channelName} logo`}
                className="h-20 w-20 rounded-full border border-white/10 object-cover"
              />
            </div>

            <div className={badgeClassName}>
              <span className="h-5 w-5 rounded-full bg-current" />
              {badgeText}
            </div>

            <h1 className="text-3xl font-semibold tracking-tight text-white">{channelName}</h1>
            <p className="mt-2 text-sm" style={{ color: '#A8C4EC' }}>
              {channelTagline}
            </p>

            <div className="mt-8 flex w-full flex-col gap-3">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuetext="Loading..."
                aria-busy="true"
                className="relative h-2 overflow-hidden rounded-full bg-white/10"
              >
                <motion.div
                  className="absolute inset-y-0 left-0 w-full"
                  style={{ background: 'linear-gradient(90deg, #0474C4, #A8C4EC)' }}
                  initial={{ x: '-100%' }}
                  animate={{ x: '100%' }}
                  transition={{ duration: shouldReduceMotion ? 0 : 1.4, ease: 'easeInOut', repeat: Infinity, repeatType: 'mirror' }}
                />
              </div>

              <div className="text-center text-[11px] uppercase tracking-[0.25em]" style={{ color: '#7BA4CF' }}>
                Preparing your experience
              </div>
            </div>
          </motion.div>

          <p className="absolute bottom-6 text-sm font-medium" style={{ color: '#5379AE' }}>
            v1.0.0
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}