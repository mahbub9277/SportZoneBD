import { useMemo } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { buildCloudinaryUrl } from '../../utils/cloudinary'
import localLogo from '../../assets/site.logo.webp'
import { APP_VERSION } from '../../features/pwa/appInfo'

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
      'relative flex w-[calc(100%-2rem)] max-w-[28rem] flex-col items-center rounded-[2rem] border px-6 py-8 text-center shadow-[0_24px_90px_rgba(1,10,28,0.42)] backdrop-blur-xl sm:px-10 sm:py-10 ' +
      (isPremium ? 'border-cyan-300/20 bg-slate-950/80' : 'border-white/12 bg-slate-900/80')
    ),
    [isPremium],
  )

  const badgeClassName = useMemo(
    () => (
      'mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] ' +
      (isPremium ? 'border-cyan-400/30 bg-cyan-500/12 text-cyan-100' : 'border-white/12 bg-white/8 text-sky-100')
    ),
    [isPremium],
  )

  const logoClassName = useMemo(
    () => (
      'relative mb-6 flex h-28 w-28 items-center justify-center overflow-hidden rounded-[2rem] border p-3 shadow-[0_18px_70px_rgba(14,165,233,0.2)] sm:h-32 sm:w-32 ' +
      (isPremium ? 'border-cyan-300/30 bg-linear-to-br from-cyan-400/25 via-slate-950 to-violet-700/35' : 'border-white/15 bg-slate-950/55')
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
          className="fixed inset-0 z-9999 flex items-center justify-center overflow-hidden bg-slate-950 px-4 py-8"
        >
          <div className="absolute inset-0" style={backdropStyle} />

          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.55, ease: [0.22, 1, 0.36, 1], delay: shouldReduceMotion ? 0 : 0.08 }}
            className={shellClassName}
          >
            <div className="sr-only" role="status" aria-live="polite">
              Loading application, please wait.
            </div>

            <div className="pointer-events-none absolute inset-0 rounded-4xl border border-white/8" />

            <div className="relative perspective-[900px]" aria-hidden="true">
              <motion.div
                animate={shouldReduceMotion ? undefined : { rotateY: [-5, 5, -5], rotateX: [2, -2, 2], y: [0, -2, 0] }}
                transition={{ duration: 5.5, ease: 'easeInOut', repeat: Infinity }}
                style={{ transformStyle: 'preserve-3d', willChange: 'transform' }}
                className="relative"
              >
                <motion.div
                  animate={shouldReduceMotion ? undefined : { rotate: 360 }}
                  transition={{ duration: 18, ease: 'linear', repeat: Infinity }}
                  className="absolute -inset-3 rounded-[2.3rem] border border-sky-300/20"
                  style={{ transform: 'translateZ(-18px)', willChange: 'transform' }}
                />
                <div className={logoClassName}>
                  <img
                    src={logoSource}
                    alt={`${channelName} logo`}
                    width={128}
                    height={128}
                    decoding="async"
                    className="h-full w-full object-contain drop-shadow-[0_10px_18px_rgba(0,0,0,0.35)]"
                  />
                </div>
              </motion.div>
            </div>

            <div className={badgeClassName}>
              <span className="h-5 w-5 rounded-full bg-current" />
              {badgeText}
            </div>

            <h1 className="text-[clamp(1.75rem,6vw,2.35rem)] font-semibold leading-tight tracking-[-0.02em] text-white">{channelName}</h1>
            <p className="mt-2 max-w-xs text-sm leading-6 text-sky-100/75">
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
                  animate={shouldReduceMotion ? { x: '0%' } : { x: '100%' }}
                  transition={{ duration: 1.5, ease: 'easeInOut', repeat: shouldReduceMotion ? 0 : Infinity, repeatType: 'mirror' }}
                />
              </div>

              <div className="text-center text-[10px] font-medium uppercase tracking-[0.22em] text-sky-100/55">
                Preparing your experience
              </div>
            </div>
          </motion.div>

          <p className="absolute bottom-5 text-[10px] font-medium uppercase tracking-[0.2em] text-sky-200/35">
            v{APP_VERSION}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}