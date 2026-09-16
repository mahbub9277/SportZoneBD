import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Maximize2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CustomVideoPlayer } from '../CustomVideoPlayer'

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
  const [miniPosition, setMiniPosition] = useState({ x: 0, y: 0 })
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; width: number; height: number } | null>(null)
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
    setMiniPosition({ x: 0, y: 0 })
    if (miniSurfaceRef.current) miniSurfaceRef.current.style.translate = '0 0'
  }, [])

  useEffect(() => {
    if (!activePlayer) {
      setIsMini(!isPlayerPage)
      resetMiniSurfaceState()
      return
    }

    setIsMini(false)
    resetMiniSurfaceState()
  }, [activePlayer, isPlayerPage, resetMiniSurfaceState])

  useEffect(() => {
    if (!isMini) {
      resetMiniSurfaceState()
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
    dragStateRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: miniPositionRef.current.x, originY: miniPositionRef.current.y, width, height }
    pendingMiniVisualRef.current = { ...miniPositionRef.current, width }
    if (miniSurfaceRef.current) miniSurfaceRef.current.style.willChange = 'translate'
  }, [isMini])

  const handleMiniDragMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const nextPosition = clampMiniPosition({ x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY }, drag.width, drag.height)
    pendingMiniVisualRef.current = { ...nextPosition }
    scheduleMiniVisualUpdate()
  }, [clampMiniPosition, scheduleMiniVisualUpdate])

  const handleMiniDragEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const nextPosition = pendingMiniVisualRef.current ?? miniPositionRef.current
    miniPositionRef.current = { x: nextPosition.x, y: nextPosition.y }
    setMiniPosition(miniPositionRef.current)
    if (miniSurfaceRef.current) {
      miniSurfaceRef.current.style.willChange = 'auto'
      window.requestAnimationFrame(() => {
        if (miniSurfaceRef.current) miniSurfaceRef.current.style.translate = '0 0'
      })
    }
    dragStateRef.current = null
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
    setMiniPosition(nextPosition)
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
    setMiniPosition(initialPosition)

    const handleViewportResize = () => {
      const width = miniWidthRef.current
      const nextPosition = clampMiniPosition(miniPositionRef.current, width, width * 9 / 16)
      miniPositionRef.current = nextPosition
      pendingMiniVisualRef.current = { ...nextPosition, width }
      scheduleMiniVisualUpdate()
      setMiniPosition(nextPosition)
    }
    window.addEventListener('resize', handleViewportResize, { passive: true })
    return () => window.removeEventListener('resize', handleViewportResize)
  }, [activePlayer, clampMiniPosition, isMini, scheduleMiniVisualUpdate])

  useEffect(() => {
    if (!isPlayerPage || !activePlayer) return
    const anchor = playerFootprintRef.current
    if (!anchor || !('IntersectionObserver' in window)) return
    const header = document.querySelector('header')
    const headerBottom = header instanceof HTMLElement ? header.getBoundingClientRect().bottom : 80
    const visibilityThreshold = 0.01
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && entry.intersectionRatio > visibilityThreshold) setIsMini(false)
      else if (!entry.isIntersecting || entry.intersectionRatio <= visibilityThreshold) setIsMini(true)
    }, { threshold: [0, visibilityThreshold], rootMargin: `-${Math.ceil(headerBottom + 8)}px 0px 0px` })
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
            className={isMini ? 'fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-3 z-30 overflow-hidden rounded-3xl border border-white/15 bg-[#262B40]/95 shadow-[0_20px_60px_rgba(0,0,0,0.55)] ring-1 ring-[#0474C4]/25 backdrop-blur-xl' : 'relative z-10 w-full'}
            style={isMini ? { width: `min(${miniWidth}px, calc(100vw - 1.5rem))`, x: miniPosition.x, y: miniPosition.y } : undefined}
            onTouchStart={isMini ? handleMiniPinchStart : undefined}
            onTouchMove={isMini ? handleMiniPinchMove : undefined}
            onTouchEnd={isMini ? handleMiniPinchEnd : undefined}
            onTouchCancel={isMini ? handleMiniPinchEnd : undefined}
          >
            {isMini && <div className="absolute inset-x-8 top-2 z-40 flex h-6 cursor-grab touch-none items-center justify-center active:cursor-grabbing transition-colors hover:text-white/80" onPointerDown={handleMiniDragStart} onPointerMove={handleMiniDragMove} onPointerUp={handleMiniDragEnd} onPointerCancel={handleMiniDragEnd} role="button" tabIndex={0} aria-label="Move mini player" title="Drag to move mini player"><div className="flex items-center gap-1 rounded-full border border-white/20 bg-black/65 px-2.5 py-1 shadow-lg"><span className="h-1.5 w-6 rounded-full bg-white/40" /></div></div>}
            {isMini && activePlayer.playbackRoute && <motion.button type="button" className="absolute right-12 top-2 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-cyan-400/30 bg-black/75 text-white/90 shadow-lg transition hover:border-cyan-400/60 hover:bg-black hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" aria-label="Open full player" title="Open full player" onClick={restorePlayer} whileHover={shouldReduceMotion ? undefined : { scale: 1.08 }} whileTap={shouldReduceMotion ? undefined : { scale: 0.92 }}><Maximize2 className="h-4 w-4" /></motion.button>}
            {isMini && <motion.button type="button" className="absolute right-2 top-2 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-red-400/30 bg-black/75 text-white/90 shadow-lg transition hover:border-red-400/60 hover:bg-black hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300" aria-label="Close mini player" onClick={(event) => { event.stopPropagation(); closePlayer() }} whileHover={shouldReduceMotion ? undefined : { scale: 1.08 }} whileTap={shouldReduceMotion ? undefined : { scale: 0.92 }}><X className="h-4 w-4" /></motion.button>}
            <CustomVideoPlayer
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
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
