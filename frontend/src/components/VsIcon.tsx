import { cn } from '../lib/utils'

/**
 * The fixture's "VS" mark — the one graphic separator the app draws between two teams.
 *
 * It is drawn with theme tokens only: the capsule uses the card surfaces, border and accent, and the
 * wordmark inherits the surrounding text colour while a surface-coloured outline keeps it readable
 * wherever the capsule sits. The viewBox is fixed and the glyph is sized by class, so the mark scales
 * with the breakpoint without shifting the layout around it, and it carries no animation — it has to
 * read at a glance without pulling attention away from the two crests it sits between.
 */
const VS_ICON_SIZES = {
  sm: { capsule: 'rounded-lg px-1.5 py-0.5', glyph: 'h-5' },
  md: { capsule: 'rounded-xl px-1.5 py-1 sm:rounded-2xl sm:px-2 sm:py-1.5', glyph: 'h-8 sm:h-9' },
  lg: { capsule: 'rounded-2xl px-3 py-1.5', glyph: 'h-11' },
} as const

export type VsIconSize = keyof typeof VS_ICON_SIZES

interface VsIconProps {
  /** Sizing preset for surfaces other than the match card. */
  size?: VsIconSize
  className?: string
  /** Accessible label; "Versus" is what the mark means, not how it is drawn. */
  label?: string
}

export function VsIcon({ size = 'md', className, label = 'Versus' }: VsIconProps) {
  const { capsule, glyph } = VS_ICON_SIZES[size]

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-(--accent)/20 bg-(--surface-strong)/90 shadow-[0_6px_18px_rgba(4,116,196,0.12)]',
        capsule,
        className,
      )}
    >
      {/* A hairline of accent along the top edge and a faint wash inside: enough to lift the capsule
          off the card without a blur layer or a second colour. */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-(--accent)/55 to-transparent" />
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-linear-to-b from-(--accent)/10 via-transparent to-(--accent)/5" />

      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 64 32"
        role="img"
        aria-label={label}
        focusable="false"
        className={cn('relative w-auto text-(--text-primary)', glyph)}
      >
        {/* The slanted bar behind the wordmark is the mark's own identity; the four strokes carry the
            "against each other" idea, kept far below the crests' contrast so they never compete. */}
        <path d="M30.5 6 34 26" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3" opacity="0.13" />
        <path d="M11 8.5 19 14M11 23.5l8-5.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" opacity="0.22" />
        <path d="M53 8.5 45 14M53 23.5l-8-5.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" opacity="0.22" />
        <text
          x="32"
          y="22.5"
          textAnchor="middle"
          fontFamily="inherit"
          fontSize="18"
          fontStyle="italic"
          fontWeight="900"
          letterSpacing="0.5"
          fill="currentColor"
          className="stroke-(--surface-strong)"
          strokeLinejoin="round"
          strokeWidth="1.4"
          paintOrder="stroke"
        >
          VS
        </text>
      </svg>
    </span>
  )
}
