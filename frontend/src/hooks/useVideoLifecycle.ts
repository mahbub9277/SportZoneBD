import { useEffect, useRef } from 'react'

interface UseVideoLifecycleOptions {
  video: HTMLMediaElement | null
  sourceKey: string
  isCurrent: () => boolean
  onLoadStart?: () => void
  onWaiting?: () => void
  onPlaying?: () => void
  onReady?: () => void
  onStalled?: () => void
  onError?: () => void
  onPause?: () => void
  onLoadedMetadata?: () => void
  onSuspend?: () => void
  onEmptied?: () => void
  onSeeking?: () => void
  onSeeked?: () => void
  onEnded?: () => void
}

type LifecycleCallbackName =
  | 'onLoadStart'
  | 'onWaiting'
  | 'onPlaying'
  | 'onReady'
  | 'onStalled'
  | 'onError'
  | 'onPause'
  | 'onLoadedMetadata'
  | 'onSuspend'
  | 'onEmptied'
  | 'onSeeking'
  | 'onSeeked'
  | 'onEnded'

interface VideoLifecycleCallbacks {
  isCurrent: () => boolean
  onLoadStart?: () => void
  onWaiting?: () => void
  onPlaying?: () => void
  onReady?: () => void
  onStalled?: () => void
  onError?: () => void
  onPause?: () => void
  onLoadedMetadata?: () => void
  onSuspend?: () => void
  onEmptied?: () => void
  onSeeking?: () => void
  onSeeked?: () => void
  onEnded?: () => void
}

export function useVideoLifecycle({
  video,
  sourceKey,
  isCurrent,
  onLoadStart,
  onWaiting,
  onPlaying,
  onReady,
  onStalled,
  onError,
  onPause,
  onLoadedMetadata,
  onSuspend,
  onEmptied,
  onSeeking,
  onSeeked,
  onEnded,
}: UseVideoLifecycleOptions) {
  const callbacksRef = useRef<VideoLifecycleCallbacks>({
    isCurrent,
    onLoadStart,
    onWaiting,
    onPlaying,
    onReady,
    onStalled,
    onError,
    onPause,
    onLoadedMetadata,
    onSuspend,
    onEmptied,
    onSeeking,
    onSeeked,
    onEnded,
  })

  useEffect(() => {
    callbacksRef.current = {
      isCurrent,
      onLoadStart,
      onWaiting,
      onPlaying,
      onReady,
      onStalled,
      onError,
      onPause,
      onLoadedMetadata,
      onSuspend,
      onEmptied,
      onSeeking,
      onSeeked,
      onEnded,
    }
  }, [isCurrent, onEmptied, onEnded, onError, onLoadStart, onLoadedMetadata, onPause, onPlaying, onReady, onSeeked, onSeeking, onStalled, onSuspend, onWaiting])

  useEffect(() => {
    if (!video) return

    const eventMap: ReadonlyArray<readonly [string, LifecycleCallbackName]> = [
      ['loadstart', 'onLoadStart'],
      ['waiting', 'onWaiting'],
      ['playing', 'onPlaying'],
      ['canplay', 'onReady'],
      ['loadeddata', 'onReady'],
      ['loadedmetadata', 'onLoadedMetadata'],
      ['canplaythrough', 'onReady'],
      ['stalled', 'onStalled'],
      ['suspend', 'onSuspend'],
      ['emptied', 'onEmptied'],
      ['seeking', 'onSeeking'],
      ['seeked', 'onSeeked'],
      ['ended', 'onEnded'],
      ['error', 'onError'],
      ['pause', 'onPause'],
    ]

    const handlers = new Map<string, () => void>()

    for (const [eventName, callbackName] of eventMap) {
      const handler = () => {
        const callbacks = callbacksRef.current
        if (callbacks.isCurrent() && callbacks[callbackName]) {
          callbacks[callbackName]?.()
        }
      }

      handlers.set(eventName, handler)
      video.addEventListener(eventName, handler)
    }

    return () => {
      for (const [eventName, handler] of handlers.entries()) {
        video.removeEventListener(eventName, handler)
      }
    }
  }, [sourceKey, video])
}
