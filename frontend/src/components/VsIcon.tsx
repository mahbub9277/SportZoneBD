/**
 * The fixture's "VS" mark.
 *
 * It is drawn with theme tokens only — the capsule uses the card surface and border, and the mark
 * inherits the current text colour — so it stays legible on the light and the dark theme instead of
 * relying on a fixed white glyph with a fixed dark halo. The width is intrinsic to the viewBox, so the
 * graphic scales proportionally at every breakpoint.
 */
export function VsIcon({ className }: { className?: string }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-xl border border-(--border) bg-(--surface-strong)/85 px-1.5 py-1 shadow-[0_6px_18px_rgba(4,116,196,0.12)] sm:rounded-2xl sm:px-2 sm:py-1.5">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 56 32"
        role="img"
        aria-label="Versus"
        focusable="false"
        className={className ?? 'h-8 w-auto text-(--text-primary) sm:h-9'}
      >
        <path d="M7 5 17 13M8 19l7 7M49 5 39 13M48 19l-7 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" opacity="0.26" />
        <path d="m13 7 8 6M43 7l-8 6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" opacity="0.16" />
        <text
          x="28"
          y="22"
          textAnchor="middle"
          fontFamily="inherit"
          fontSize="19"
          fontStyle="italic"
          fontWeight="900"
          fill="currentColor"
          className="stroke-(--surface-strong)"
          strokeLinejoin="round"
          strokeWidth="1.2"
          paintOrder="stroke"
        >
          VS
        </text>
      </svg>
    </span>
  )
}
