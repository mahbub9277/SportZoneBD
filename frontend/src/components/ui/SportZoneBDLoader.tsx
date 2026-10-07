import appLogo from '../../assets/site.logo.webp'
import { cn } from '../../lib/utils'

export type SportZoneBDLoaderVariant = 'loading' | 'buffering'

const VARIANT_LABELS: Record<SportZoneBDLoaderVariant, string> = {
  loading: 'Loading video…',
  buffering: 'Buffering…',
}

export interface SportZoneBDLoaderProps {
  /** `loading` is the initial source load, `buffering` is a stall in already playing media. */
  variant?: SportZoneBDLoaderVariant
  /** Overrides the variant's default wording. */
  label?: string
  /** Extra classes for the overlay container, for example to change the positioning context. */
  className?: string
}

/**
 * The SportZoneBD loading and buffering overlay.
 *
 * It is presentation only: the media lifecycle (readiness, buffering, source identity, errors) stays in
 * the player, which decides which variant to render. The overlay spans its nearest positioned parent
 * and is pointer-transparent, so it never covers the video frame, a control, the settings menu, or a
 * touch/mouse gesture underneath it.
 *
 * Both variants animate with transforms and opacity only, and the animation is dropped when the user
 * prefers reduced motion.
 */
export function SportZoneBDLoader({ variant = 'loading', label, className }: SportZoneBDLoaderProps) {
  const isBuffering = variant === 'buffering'
  const resolvedLabel = label ?? VARIANT_LABELS[variant]

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={resolvedLabel}
      className={cn(
        // Lifted off the exact centre so the loader never sits behind a centred transport control. A
        // surface without one (the compact mini player) can pass `translate-y-0` to stay centred.
        'pointer-events-none absolute inset-0 z-20 flex -translate-y-12 items-center justify-center sm:-translate-y-14',
        className,
      )}
    >
      <div
        className={cn(
          'inline-flex items-center rounded-full border border-[#5379AE]/40 bg-[#262B40]/90 shadow-[0_14px_36px_rgba(0,0,0,0.35)] backdrop-blur-md',
          isBuffering ? 'gap-2.5 px-3 py-1.5' : 'gap-3 px-3.5 py-2',
        )}
      >
        <span className="relative inline-flex shrink-0 items-center justify-center">
          <span
            aria-hidden="true"
            className="absolute -inset-1 animate-spin rounded-full border-2 border-[#0474C4]/25 border-t-[#0474C4] motion-reduce:animate-none"
          />
          <span
            className={cn(
              'animate-pulse overflow-hidden rounded-full border border-white/15 bg-white/95 shadow-[0_0_18px_rgba(4,116,196,0.35)] motion-reduce:animate-none',
              isBuffering ? 'h-6 w-6' : 'h-9 w-9 sm:h-10 sm:w-10',
            )}
          >
            <img src={appLogo} alt="" aria-hidden="true" decoding="async" className="h-full w-full object-cover" />
          </span>
        </span>

        <span className={cn('font-semibold text-[#A8C4EC]', isBuffering ? 'text-[11px] sm:text-xs' : 'text-xs sm:text-sm')}>
          {resolvedLabel}
        </span>
      </div>
    </div>
  )
}
