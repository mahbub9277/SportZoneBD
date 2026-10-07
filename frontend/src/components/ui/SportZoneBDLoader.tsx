import appLogo from '../../assets/site.logo.webp'
import { cn } from '../../lib/utils'

export type SportZoneBDLoaderVariant = 'loading' | 'buffering'

const VARIANT_LABELS: Record<SportZoneBDLoaderVariant, string> = {
  loading: 'Loading stream…',
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
 * The visual is a small logo chip with a soft glow, surrounded by thin rings that expand and fade on
 * staggered delays so they read as one continuous wave. Only `transform` and `opacity` animate, and the
 * motion is dropped when the user prefers reduced motion.
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
        // Centred in the loading area: the surface has no centred transport control any more, so the
        // overlay sits exactly where the viewer looks for the state.
        'pointer-events-none absolute inset-0 z-20 flex items-center justify-center',
        className,
      )}
    >
      <div
        className={cn(
          'inline-flex items-center rounded-full border border-[#5379AE]/30 bg-[#262B40]/85 shadow-[0_10px_30px_rgba(3,7,16,0.45)] backdrop-blur-md',
          isBuffering ? 'gap-2 py-1 pr-3 pl-1' : 'gap-2.5 py-1.5 pr-3.5 pl-1.5',
        )}
      >
        <span className={cn('relative inline-flex shrink-0 items-center justify-center', isBuffering ? 'h-9 w-9' : 'h-10 w-10 sm:h-11 sm:w-11')}>
          {[0, 0.9, 1.8].map((delay) => (
            <span
              key={delay}
              aria-hidden="true"
              className="absolute inset-0 animate-ping rounded-full border border-[#5379AE]/45 motion-reduce:animate-none"
              style={{ animationDuration: isBuffering ? '2.4s' : '2.8s', animationDelay: `${delay}s` }}
            />
          ))}
          <span
            className={cn(
              'relative inline-flex items-center justify-center overflow-hidden rounded-[10px] border border-[#5379AE]/35 bg-[#0F1526]/90',
              'shadow-[0_0_0_1px_rgba(83,121,174,0.18),0_6px_18px_rgba(4,116,196,0.3)]',
              isBuffering ? 'h-9 w-9' : 'h-10 w-10 sm:h-11 sm:w-11',
            )}
          >
            <img
              src={appLogo}
              alt=""
              aria-hidden="true"
              decoding="async"
              className={cn('object-contain', isBuffering ? 'h-8 w-8' : 'h-9 w-9 sm:h-10 sm:w-10')}
            />
          </span>
        </span>

        <span className={cn('font-medium text-[#A8C4EC]/85', isBuffering ? 'text-[10px] sm:text-[11px]' : 'text-[11px] sm:text-[12px]')}>
          {resolvedLabel}
        </span>
      </div>
    </div>
  )
}
