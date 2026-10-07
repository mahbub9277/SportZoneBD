import appLogo from '../../assets/site.logo.webp'
import { cn } from '../../lib/utils'

export type SportZoneBDLoaderVariant = 'loading' | 'buffering'

const VARIANT_LABELS: Record<SportZoneBDLoaderVariant, string> = {
  loading: 'Loading…',
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
 * The visual is the real brand asset held perfectly still inside three concentric blue rings that share
 * one heartbeat, with a soft left/right energy bloom and the status text beneath it. The geometry and
 * keyframes live in the scoped `szb-loader*` rules in `index.css`; only `transform` and `opacity`
 * animate, the sizing is fluid so the same loader fits a mini card through to a TV, and the motion stops
 * (with every part still visible) when the user prefers reduced motion.
 */
export function SportZoneBDLoader({ variant = 'loading', label, className }: SportZoneBDLoaderProps) {
  const resolvedLabel = label ?? VARIANT_LABELS[variant]

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={resolvedLabel}
      className={cn(
        // Centred in the loading area: the surface has no centred transport control any more, so the
        // overlay sits exactly where the viewer looks for the state.
        'szb-loader pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 px-4',
        className,
      )}
    >
      <span aria-hidden="true" className="szb-loader-scrim" />

      <span aria-hidden="true" className="szb-loader-stage relative inline-flex shrink-0 items-center justify-center">
        <span className="szb-loader-bloom" />
        <span className="szb-loader-ring szb-loader-ring--inner" />
        <span className="szb-loader-ring szb-loader-ring--middle" />
        <span className="szb-loader-ring szb-loader-ring--outer" />
        {/* The brand asset itself: contain-fit, no rotation, no motion of its own. */}
        <img src={appLogo} alt="" aria-hidden="true" decoding="async" className="szb-loader-logo" />
      </span>

      <span className="relative max-w-72 text-center text-[12px] font-medium tracking-[0.04em] text-[#A8C4EC]/85 sm:text-[13px]">
        {resolvedLabel}
      </span>
    </div>
  )
}
