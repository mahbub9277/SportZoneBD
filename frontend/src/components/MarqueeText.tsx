import { startTransition, useEffect, useRef, useState } from 'react'

import { cn } from '../lib/utils'

interface MarqueeTextProps {
  text: string
  /**
   * False for reduced motion and for devices the app already treats as constrained: the text is then
   * clipped instead of moving, and nothing is measured.
   */
  animated?: boolean
  className?: string
}

/**
 * One line that stays put while it fits and becomes a seamless ticker once it does not.
 *
 * The overflow is measured only when the column actually changes size (no polling, no per-card timer),
 * and the movement itself is a CSS transform, so activating or disabling it costs no extra JS.
 */
export function MarqueeText({ text, animated = true, className }: MarqueeTextProps) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const itemRef = useRef<HTMLSpanElement>(null)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    if (!animated || typeof ResizeObserver === 'undefined') return
    const container = containerRef.current
    const item = itemRef.current
    if (!container || !item) return

    const measure = () => {
      const next = item.scrollWidth > container.clientWidth + 1
      startTransition(() => setOverflowing(next))
    }
    // ResizeObserver reports the current size as soon as observation starts, so the first measurement
    // happens here instead of synchronously during render.
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [animated, text])

  if (!animated || !overflowing) {
    return (
      <span ref={containerRef} className={cn('block min-w-0', className)}>
        <span ref={itemRef} className="block truncate">{text}</span>
      </span>
    )
  }

  // Two copies sit side by side so the loop never shows a gap. The duplicate is hidden from assistive
  // technology, which reads the line once, and the full text stays available as a tooltip.
  return (
    <span ref={containerRef} className={cn('szb-marquee block min-w-0', className)} title={text}>
      <span className="szb-marquee-track" style={{ animationDuration: `${Math.min(26, Math.max(10, Math.round(text.length * 0.34)))}s` }}>
        <span ref={itemRef} className="szb-marquee-item">{text}</span>
        <span className="szb-marquee-item" aria-hidden="true">{text}</span>
      </span>
    </span>
  )
}
