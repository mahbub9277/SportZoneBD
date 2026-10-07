const NOISE_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='static'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='140' height='140' filter='url(#static)' opacity='0.6'/></svg>`

const NOISE_TEXTURE = `url("data:image/svg+xml;utf8,${encodeURIComponent(NOISE_SVG)}")`

const SCANLINES = 'repeating-linear-gradient(0deg, rgba(83,121,174,0.35) 0px, rgba(83,121,174,0.35) 1px, transparent 1px, transparent 5px)'

/**
 * Television static shown behind the error card while a channel has no usable signal.
 *
 * Purely presentational: the animation is CSS-only (two `animate-pulse` noise layers at different
 * rates) and stops for users who prefer reduced motion. It never renders during buffering and never
 * replaces the error card, which stays on top and remains the actionable layer.
 */
export function NoSignalOverlay({ label = 'NO SIGNAL' }: { label?: string }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-20 overflow-hidden bg-[#0c1122]">
      <div
        className="absolute inset-0 animate-pulse bg-repeat opacity-40 mix-blend-screen motion-reduce:animate-none"
        style={{ backgroundImage: NOISE_TEXTURE, backgroundSize: '140px 140px', animationDuration: '1.1s' }}
      />
      <div
        className="absolute inset-0 animate-pulse bg-repeat opacity-25 mix-blend-screen motion-reduce:animate-none"
        style={{ backgroundImage: NOISE_TEXTURE, backgroundSize: '230px 230px', animationDuration: '1.7s', animationDelay: '0.4s' }}
      />
      <div className="absolute inset-0 opacity-20" style={{ backgroundImage: SCANLINES }} />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(8,12,26,0.85)_100%)]" />
      {/* Sits above the error card so the two never overlap: the card stays the actionable layer. */}
      <span className="absolute inset-x-0 top-5 text-center text-[11px] font-black tracking-[0.5em] text-[#5379AE] uppercase sm:top-7 sm:text-[13px]">
        {label}
      </span>
    </div>
  )
}
