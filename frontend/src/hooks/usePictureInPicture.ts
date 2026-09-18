import { useCallback, useEffect, useState, type RefObject } from 'react'

interface SafariVideoElement extends HTMLVideoElement {
  webkitPresentationMode?: 'inline' | 'picture-in-picture' | 'fullscreen'
  webkitSetPresentationMode?: (mode: 'inline' | 'picture-in-picture') => void
}

export function usePictureInPicture(videoRef: RefObject<HTMLMediaElement | null>) {
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

    const video = videoRef.current as SafariVideoElement | null
    if (video) {
      video.addEventListener('webkitpresentationmodechanged', handlePiPChange)
      video.addEventListener('enterpictureinpicture', handlePiPChange)
      video.addEventListener('leavepictureinpicture', handlePiPChange)
    }

    return () => {
      cancelled = true
      if (typeof document !== 'undefined') {
        document.removeEventListener('enterpictureinpicture', handlePiPChange)
        document.removeEventListener('leavepictureinpicture', handlePiPChange)
      }

      video?.removeEventListener('webkitpresentationmodechanged', handlePiPChange)
      video?.removeEventListener('enterpictureinpicture', handlePiPChange)
      video?.removeEventListener('leavepictureinpicture', handlePiPChange)
    }
  }, [syncState, videoRef])

  return { isActive, isSupported, toggle }
}
