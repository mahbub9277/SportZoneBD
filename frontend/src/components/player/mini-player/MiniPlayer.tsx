import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Maximize2, X } from 'lucide-react'
import { lazy, startTransition, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getRootMarginBelowHeader } from '../../../utils/intersectionMargin'

const LazyCustomVideoPlayer = lazy(() =>
  import('../CustomVideoPlayer').then((module) => ({ default: module.CustomVideoPlayer })),
)

export interface MiniPlayerSource {
  url: string
  title?: string
  streamId?: string
  presenceType?: 'stream' | 'channel' | 'match'
  matchId?: string
  channelId?: string
  playbackRoute?: string
}

interface MiniPlayerProps {
  activePlayer: MiniPlayerSource | null
  setActivePlayer: (player: MiniPlayerSource | null) => void
}

export function MiniPlayer({ activePlayer, setActivePlayer }: MiniPlayerProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const shouldReduceMotion = useReducedMotion()
  const isPlayerPage = location.pathname.startsWith('/watch/')
  const [isMini, setIsMini] = useState(!isPlayerPage)
  const [miniWidth, setMiniWidth] = useState(340)
  // The position lives in a ref plus the element's own CSS `translate`: dragging writes that property
  // directly (one transform source, no React re-render per pointer move), so the card tracks the
  // pointer exactly and never fights a second transform.
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; bounds: { minX: number; maxX: number; minY: number; maxY: number } } | null>(null)
  const pinchStateRef = useRef<{ distance: number; startWidth: number } | null>(null)
  const miniSurfaceRef = useRef<HTMLDivElement | null>(null)
  const miniPositionRef = useRef({ x: 0, y: 0 })
  const miniWidthRef = useRef(340)
  const pendingMiniFrameRef = useRef<number | null>(null)
  const pendingMiniVisualRef = useRef<{ x: number; y: number; width?: number } | null>(null)
  const playerFootprintRef = useRef<HTMLDivElement | null>(null)
  const stopPlayerRef = useRef<(() => void) | null>(null)
  const stopRequestedRef = useRef(false)

  const resetMiniSurfaceState = useCallback(() => {
    miniPositionRef.current = { x: 0, y: 0 }
    pendingMiniVisualRef.current = null
    dragStateRef.current = null
    pinchStateRef.current = null
    if (miniSurfaceRef.current) miniSurfaceRef.current.style.translate = '0 0'
  }, [])

  useEffect(() => {
    if (!activePlayer) {
      startTransition(() => setIsMini(!isPlayerPage))
      startTransition(() => resetMiniSurfaceState())
      return
    }

    startTransition(() => setIsMini(false))
    resetMiniSurfaceState()
  }, [activePlayer, isPlayerPage, resetMiniSurfaceState])

  useEffect(() => {
    if (!isMini) {
      startTransition(() => resetMiniSurfaceState())
    }
  }, [isMini, resetMiniSurfaceState])

  const scheduleMiniVisualUpdate = useCallback(() => {
    if (pendingMiniFrameRef.current !== null) return
    pendingMiniFrameRef.current = window.requestAnimationFrame(() => {
      pendingMiniFrameRef.current = null
      const visual = pendingMiniVisualRef.current
      const surface = miniSurfaceRef.current
      if (!visual || !surface) return
      surface.style.translate = `${visual.x}px ${visual.y}px`
      if (typeof visual.width === 'number') surface.style.width = `min(${visual.width}px, calc(100vw - 1.5rem))`
    })
  }, [])

  const getMiniBounds = useCallback((width: number, height: number) => {
    const safeInset = 12
    const bottomOffset = 72
    const baseLeft = window.innerWidth - width - safeInset
    const baseTop = window.innerHeight - bottomOffset - height
    const header = document.querySelector('header')
    const headerBottom = header instanceof HTMLElement ? header.getBoundingClientRect().bottom : 80
    const topSafeBoundary = Math.max(safeInset, headerBottom + 8)
    return {
      minX: safeInset - baseLeft,
      maxX: 0,
      minY: topSafeBoundary - baseTop,
      maxY: Math.max(topSafeBoundary - baseTop, window.innerHeight - safeInset - height - baseTop),
    }
  }, [])

  const clampMiniPosition = useCallback((position: { x: number; y: number }, width: number, height: number) => {
    const bounds = getMiniBounds(width, height)
    return {
      x: Math.min(bounds.maxX, Math.max(bounds.minX, position.x)),
      y: Math.min(bounds.maxY, Math.max(bounds.minY, position.y)),
    }
  }, [getMiniBounds])

  const handleMiniDragStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isMini || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const surfaceRect = miniSurfaceRef.current?.getBoundingClientRect()
    const width = surfaceRect?.width ?? miniWidthRef.current
    const height = surfaceRect?.height ?? width * 9 / 16
    // Bounds are measured once per drag instead of on every pointer move, so the drag never forces a
    // layout read and stays smooth even while the video is playing.
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: miniPositionRef.current.x,
      originY: miniPositionRef.current.y,
      bounds: getMiniBounds(width, height),
    }
    if (miniSurfaceRef.current) miniSurfaceRef.current.style.willChange = 'translate'
  }, [getMiniBounds, isMini])

  const handleMiniDragMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const { bounds } = drag
    // 1:1 with the pointer: the card follows the finger or cursor exactly, inside the cached bounds.
    pendingMiniVisualRef.current = {
      x: Math.min(bounds.maxX, Math.max(bounds.minX, drag.originX + event.clientX - drag.startX)),
      y: Math.min(bounds.maxY, Math.max(bounds.minY, drag.originY + event.clientY - drag.startY)),
    }
    scheduleMiniVisualUpdate()
  }, [scheduleMiniVisualUpdate])

  const moveMiniBy = useCallback((deltaX: number, deltaY: number) => {
    const width = miniWidthRef.current
    const bounds = getMiniBounds(width, width * 9 / 16)
    miniPositionRef.current = {
      x: Math.min(bounds.maxX, Math.max(bounds.minX, miniPositionRef.current.x + deltaX)),
      y: Math.min(bounds.maxY, Math.max(bounds.minY, miniPositionRef.current.y + deltaY)),
    }
    pendingMiniVisualRef.current = { ...miniPositionRef.current }
    scheduleMiniVisualUpdate()
  }, [getMiniBounds, scheduleMiniVisualUpdate])

  const handleMiniHandleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = 24
    const offsets: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    }
    const offset = offsets[event.key]
    if (!offset) return
    // Arrow keys are global player shortcuts (seek / volume), so the move handled here stops the event
    // before it reaches the player's window-level handler.
    event.preventDefault()
    event.stopPropagation()
    moveMiniBy(offset.x, offset.y)
  }, [moveMiniBy])

  const handleMiniDragEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const nextPosition = pendingMiniVisualRef.current ?? miniPositionRef.current
    // The drop position is already on screen, so the final transform is kept as-is: no reset, no
    // re-render, and no spring that would visually jump the card back and forth.
    miniPositionRef.current = { x: nextPosition.x, y: nextPosition.y }
    dragStateRef.current = null
    window.requestAnimationFrame(() => {
      if (miniSurfaceRef.current) miniSurfaceRef.current.style.willChange = 'auto'
    })
  }, [])

  const handleMiniPinchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) return
    const [firstTouch, secondTouch] = [event.touches[0], event.touches[1]]
    pinchStateRef.current = { distance: Math.hypot(secondTouch.clientX - firstTouch.clientX, secondTouch.clientY - firstTouch.clientY), startWidth: miniWidthRef.current }
  }, [])

  const handleMiniPinchMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2 || !pinchStateRef.current) return
    const [firstTouch, secondTouch] = [event.touches[0], event.touches[1]]
    const distance = Math.hypot(secondTouch.clientX - firstTouch.clientX, secondTouch.clientY - firstTouch.clientY)
    if (distance <= 0 || pinchStateRef.current.distance <= 0) return
    const nextWidth = Math.min(600, Math.max(240, pinchStateRef.current.startWidth * (distance / pinchStateRef.current.distance)))
    miniWidthRef.current = nextWidth
    pendingMiniVisualRef.current = { ...miniPositionRef.current, width: nextWidth }
    scheduleMiniVisualUpdate()
  }, [scheduleMiniVisualUpdate])

  const handleMiniPinchEnd = useCallback(() => {
    const nextWidth = miniWidthRef.current
    const nextPosition = clampMiniPosition(miniPositionRef.current, nextWidth, nextWidth * 9 / 16)
    miniPositionRef.current = nextPosition
    pendingMiniVisualRef.current = { ...nextPosition, width: nextWidth }
    setMiniWidth(nextWidth)
    scheduleMiniVisualUpdate()
    pinchStateRef.current = null
  }, [clampMiniPosition, scheduleMiniVisualUpdate])

  useEffect(() => () => {
    if (pendingMiniFrameRef.current !== null) window.cancelAnimationFrame(pendingMiniFrameRef.current)
    dragStateRef.current = null
    pinchStateRef.current = null
  }, [])

  useEffect(() => {
    if (!isMini || !activePlayer) return

    const initialPosition = clampMiniPosition(miniPositionRef.current, miniWidthRef.current, miniWidthRef.current * 9 / 16)
    miniPositionRef.current = initialPosition
    pendingMiniVisualRef.current = { ...initialPosition, width: miniWidthRef.current }
    scheduleMiniVisualUpdate()

    const handleViewportResize = () => {
      const width = miniWidthRef.current
      const nextPosition = clampMiniPosition(miniPositionRef.current, width, width * 9 / 16)
      miniPositionRef.current = nextPosition
      pendingMiniVisualRef.current = { ...nextPosition, width }
      scheduleMiniVisualUpdate()
    }
    window.addEventListener('resize', handleViewportResize, { passive: true })
    return () => window.removeEventListener('resize', handleViewportResize)
  }, [activePlayer, clampMiniPosition, isMini, scheduleMiniVisualUpdate])

  useEffect(() => {
    if (!isPlayerPage || !activePlayer) return
    const anchor = playerFootprintRef.current
    if (!anchor || !('IntersectionObserver' in window)) return
    const header = document.querySelector('header')
    // The header is in normal document flow, so its bottom edge is negative once the page is
    // scrolled; the helper clamps that and always emits a pixel/percent rootMargin. Building the
    // string by hand used to produce "--212px 0px 0px" and take the observer down with it.
    const headerBottom = header instanceof HTMLElement ? header.getBoundingClientRect().bottom : null
    const visibilityThreshold = 0.01
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && entry.intersectionRatio > visibilityThreshold) setIsMini(false)
      else if (!entry.isIntersecting || entry.intersectionRatio <= visibilityThreshold) setIsMini(true)
    }, { threshold: [0, visibilityThreshold], rootMargin: getRootMarginBelowHeader(headerBottom) })
    observer.observe(anchor)
    return () => observer.disconnect()
  }, [activePlayer, isPlayerPage])

  const stopCurrentPlayer = useCallback(() => {
    if (stopRequestedRef.current) return

    stopRequestedRef.current = true
    const stop = stopPlayerRef.current
    stopPlayerRef.current = null
    stop?.()
  }, [])

  const closePlayer = useCallback(() => {
    stopCurrentPlayer()
    setActivePlayer(null)
  }, [setActivePlayer, stopCurrentPlayer])

  useEffect(() => {
    if (!activePlayer) return

    const shouldExitPlayerScope = !isPlayerPage || (activePlayer.playbackRoute && location.pathname !== activePlayer.playbackRoute)
    if (!shouldExitPlayerScope) return
    if (stopRequestedRef.current) return

    // Leaving the scoped watch route is a real player session exit, so stop the
    // current media instance before clearing the stored player source.
    closePlayer()
  }, [activePlayer, closePlayer, isPlayerPage, location.pathname])

  const handleStopReady = useCallback((stop: (() => void) | null) => {
    if (!stop) {
      stopPlayerRef.current = null
      stopRequestedRef.current = false
      return
    }

    stopRequestedRef.current = false
    stopPlayerRef.current = () => {
      try {
        stop()
      } finally {
        stopPlayerRef.current = null
        stopRequestedRef.current = false
      }
    }
  }, [])

  const restorePlayer = useCallback((event?: React.MouseEvent) => {
    event?.preventDefault()
    event?.stopPropagation()
    if (!activePlayer?.playbackRoute) return
    if (location.pathname !== activePlayer.playbackRoute) {
      navigate(activePlayer.playbackRoute)
      return
    }
    playerFootprintRef.current?.scrollIntoView({ behavior: shouldReduceMotion ? 'auto' : 'smooth', block: 'start' })
  }, [activePlayer, location.pathname, navigate, shouldReduceMotion])

  useEffect(() => () => {
    stopPlayerRef.current?.()
    stopPlayerRef.current = null
  }, [])

  return (
    <AnimatePresence initial={false}>
      {activePlayer && (
        <div ref={playerFootprintRef} className={isMini && isPlayerPage ? 'mb-4 aspect-video w-full' : isMini ? 'pointer-events-none h-0' : 'mb-4 aspect-video w-full'}>
          <motion.div
            ref={miniSurfaceRef}
            initial={{ opacity: 0, scale: 0.85, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 40, mass: 0.8 }}
            className={isMini ? 'fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-3 z-30 overflow-hidden rounded-3xl border border-white/15 bg-[#262B40]/95 shadow-[0_20px_60px_rgba(0,0,0,0.55)] ring-1 ring-[#0474C4]/25' : 'relative z-10 w-full'}
            style={isMini ? { width: `min(${miniWidth}px, calc(100vw - 1.5rem))` } : undefined}
            onTouchStart={isMini ? handleMiniPinchStart : undefined}
            onTouchMove={isMini ? handleMiniPinchMove : undefined}
            onTouchEnd={isMini ? handleMiniPinchEnd : undefined}
            onTouchCancel={isMini ? handleMiniPinchEnd : undefined}
          >
            {isMini && <div className="absolute left-1/2 top-2 z-40 flex h-10 w-24 -translate-x-1/2 cursor-grab touch-none items-center justify-center rounded-full text-white/70 transition-colors hover:text-white active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A8C4EC]/70" onPointerDown={handleMiniDragStart} onPointerMove={handleMiniDragMove} onPointerUp={handleMiniDragEnd} onPointerCancel={handleMiniDragEnd} onKeyDown={handleMiniHandleKeyDown} role="button" tabIndex={0} aria-label="Move mini player" title="Drag or use arrow keys to move"><div className="flex items-center gap-1 rounded-full border border-white/15 bg-[#262B40]/85 px-2.5 py-1 shadow-lg"><span className="h-1.5 w-6 rounded-full bg-white/40" /></div></div>}
            {isMini && activePlayer.playbackRoute && <motion.button type="button" className="absolute right-11 top-2 z-50 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-[#262B40]/85 text-[#DCE6F5] shadow-lg transition hover:border-[#0474C4]/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A8C4EC]/70" aria-label="Open full player" title="Open full player" onClick={restorePlayer} whileHover={shouldReduceMotion ? undefined : { scale: 1.08 }} whileTap={shouldReduceMotion ? undefined : { scale: 0.92 }}><Maximize2 className="h-4 w-4" /></motion.button>}
            {isMini && <motion.button type="button" className="absolute right-2 top-2 z-50 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-[#262B40]/85 text-[#DCE6F5] shadow-lg transition hover:border-red-400/60 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300/70" aria-label="Close mini player" title="Close mini player" onClick={(event) => { event.stopPropagation(); closePlayer() }} whileHover={shouldReduceMotion ? undefined : { scale: 1.08 }} whileTap={shouldReduceMotion ? undefined : { scale: 0.92 }}><X className="h-4 w-4" /></motion.button>}
            <Suspense fallback={null}>
              <LazyCustomVideoPlayer
                key={`${activePlayer.streamId ?? ''}|${activePlayer.url}`}
                url={activePlayer.url}
                streamId={activePlayer.streamId}
                presenceId={activePlayer.streamId}
                presenceType={activePlayer.presenceType}
                matchId={activePlayer.matchId}
                channelId={activePlayer.channelId}
                title={activePlayer.title}
                autoPlay
                compactControls={isMini}
                onStopReady={handleStopReady}
              />
            </Suspense>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
