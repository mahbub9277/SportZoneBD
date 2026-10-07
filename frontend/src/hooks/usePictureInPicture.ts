import { useCallback, useEffect, useState, type RefObject } from 'react'

interface SafariVideoElement extends HTMLVideoElement {
  webkitPresentationMode?: 'inline' | 'picture-in-picture' | 'fullscreen'
  webkitSetPresentationMode?: (mode: 'inline' | 'picture-in-picture') => void
}

/**
 * Picture-in-Picture for a media element that is created after this hook first mounts.
 *
 * The element only exists once the underlying player has rendered it, so support and active state are
 * re-evaluated whenever `isMediaReady` changes instead of being decided once while the ref is still
 * empty. Native video Picture-in-Picture is used: it is the API built for media, whereas the Document
 * Picture-in-Picture API needs the media element physically moved into another document, which is not
 * possible for the MSE-backed live streams this player mounts.
 *
 * @param videoRef Ref to the media element.
 * @param isMediaReady Flips to true once the player has attached its media element.
 */
export function usePictureInPicture(videoRef: RefObject<HTMLMediaElement | null>, isMediaReady = false) {
  const [isActive, setIsActive] = useState(false)
  const [isSupported, setIsSupported] = useState(false)

  const syncState = useCallback(() => {
    const video = videoRef.current as SafariVideoElement | null
    const standardActive = Boolean(video && typeof document !== 'undefined' && document.pictureInPictureElement === video)
    const safariActive = video?.webkitPresentationMode === 'picture-in-picture'

    setIsActive(standardActive || safariActive)

    if (!video) {
      setIsSupported(false)
      return
    }

    const videoPrototype = typeof HTMLVideoElement !== 'undefined'
      ? (HTMLVideoElement.prototype as SafariVideoElement)
      : null

    const supportsStandardPiP = Boolean(
      typeof document !== 'undefined'
      && typeof HTMLVideoElement !== 'undefined'
      && document.pictureInPictureEnabled
      && typeof videoPrototype?.requestPictureInPicture === 'function',
    )

    const supportsSafariPiP = Boolean(
      typeof HTMLVideoElement !== 'undefined'
      && typeof videoPrototype?.webkitSetPresentationMode === 'function',
    )

    setIsSupported(supportsStandardPiP || supportsSafariPiP)
  }, [videoRef])

  const toggle = useCallback(async () => {
    const video = videoRef.current
    if (!(video instanceof HTMLVideoElement) || !isSupported) return

    const safariVideo = video as SafariVideoElement

    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture()
      } else if (safariVideo.webkitPresentationMode === 'picture-in-picture' && safariVideo.webkitSetPresentationMode) {
        safariVideo.webkitSetPresentationMode('inline')
      } else if (typeof video.requestPictureInPicture === 'function' && !video.disablePictureInPicture) {
        await video.requestPictureInPicture()
      } else if (safariVideo.webkitSetPresentationMode) {
        safariVideo.webkitSetPresentationMode('picture-in-picture')
      }
    } catch {
      // Unsupported or rejected PiP requests are non-fatal.
    }
  }, [isSupported, videoRef])

  useEffect(() => {
    let cancelled = false

    const update = () => {
      if (cancelled) return
      syncState()
    }

    update()

    const handlePiPChange = () => update()

    if (typeof document !== 'undefined') {
      document.addEventListener('enterpictureinpicture', handlePiPChange)
      document.addEventListener('leavepictureinpicture', handlePiPChange)
    }

    return () => {
      cancelled = true
      if (typeof document !== 'undefined') {
        document.removeEventListener('enterpictureinpicture', handlePiPChange)
        document.removeEventListener('leavepictureinpicture', handlePiPChange)
      }
    }
  }, [isMediaReady, syncState])

  useEffect(() => {
    // Element-scoped events follow the element itself, so they are re-bound once it exists.
    const video = videoRef.current as SafariVideoElement | null
    if (!video) return

    const handlePiPChange = () => syncState()
    video.addEventListener('webkitpresentationmodechanged', handlePiPChange)
    video.addEventListener('enterpictureinpicture', handlePiPChange)
    video.addEventListener('leavepictureinpicture', handlePiPChange)

    return () => {
      video.removeEventListener('webkitpresentationmodechanged', handlePiPChange)
      video.removeEventListener('enterpictureinpicture', handlePiPChange)
      video.removeEventListener('leavepictureinpicture', handlePiPChange)
    }
  }, [isMediaReady, syncState, videoRef])

  return { isActive, isSupported, toggle }
}
