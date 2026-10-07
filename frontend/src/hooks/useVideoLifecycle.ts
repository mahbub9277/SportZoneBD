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
  onProgress?: () => void
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
  | 'onProgress'
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
  onProgress?: () => void
  onSuspend?: () => void
  onEmptied?: () => void
  onSeeking?: () => void
  onSeeked?: () => void
  onEnded?: () => void
}

/**
 * The single native-media event adapter for the player.
 *
 * It exists so that the playback lifecycle has exactly one source of media events: the listeners are
 * attached to the media element of the current source and removed when the element or the source
 * identity changes, and every callback is guarded by `isCurrent()` so a late event from a previous
 * channel, highlight or rendition can never move the current source's state.
 *
 * Readiness is also checked once when the listeners attach, so an element that already has data (a
 * cached source, or a re-attach after a quality change) reports ready without waiting for another event.
 */
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
  onProgress,
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
    onProgress,
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
      onProgress,
      onSuspend,
      onEmptied,
      onSeeking,
      onSeeked,
      onEnded,
    }
  }, [isCurrent, onEmptied, onEnded, onError, onLoadStart, onLoadedMetadata, onPause, onPlaying, onProgress, onReady, onSeeked, onSeeking, onStalled, onSuspend, onWaiting])

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
      ['progress', 'onProgress'],
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

    // Level check: an element that already holds data for this source is ready right now.
    const current = callbacksRef.current
    if (current.isCurrent()) {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) current.onReady?.()

      // `playing` is a one-shot event, so an element that started playing before these listeners existed
      // reports nothing. Only a real `timeupdate` proves playback is running: an element whose play() was
      // requested but that never received data also reports `paused === false`, and treating that as
      // playback would hide the initial loader of a dead source for good.
      if (!video.paused && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        const confirmPlaying = () => {
          video.removeEventListener('timeupdate', confirmPlaying)
          handlers.delete('timeupdate:confirm-playing')
          current.onPlaying?.()
        }
        video.addEventListener('timeupdate', confirmPlaying)
        handlers.set('timeupdate:confirm-playing', () => video.removeEventListener('timeupdate', confirmPlaying))
      }
    }

    return () => {
      for (const [eventName, handler] of handlers.entries()) {
        if (eventName === 'timeupdate:confirm-playing') handler()
        else video.removeEventListener(eventName, handler)
      }
    }
  }, [sourceKey, video])
}
