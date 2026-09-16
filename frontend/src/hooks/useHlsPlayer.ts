import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import logger from '../core/logger'

export interface HlsPlayerState {
  currentUrl: string | null
  isError: boolean
  errorMessage: string | null
  usedBackup: boolean
  hasFailedOver: boolean
  retryCount: number
}

export function useHlsPlayer(initialUrl?: string | null, streamId?: string | null) {
  const [currentUrl, setCurrentUrl] = useState<string | null>(initialUrl ?? null)
  const [isError, setIsError] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [usedBackup, setUsedBackup] = useState(false)
  const [hasFailedOver, setHasFailedOver] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [forceDirectUrl, setForceDirectUrl] = useState(false)
  const sourceGenerationRef = useRef(0)
  const mountedRef = useRef(true)

  const resetFallbackState = useCallback(() => {
    setIsError(false)
    setErrorMessage(null)
    setHasFailedOver(false)
    setUsedBackup(false)
    setRetryCount(0)
    setForceDirectUrl(false)
  }, [])

  const playbackUrl = useMemo(() => {
    if (!currentUrl) {
      return null
    }

    if (!streamId || forceDirectUrl) {
      return currentUrl
    }

    const params = new URLSearchParams({
      streamId,
      type: usedBackup ? 'backup' : 'primary',
      url: currentUrl,
    })

    return `/api/v1/stream/proxy?${params.toString()}`
  }, [currentUrl, forceDirectUrl, streamId, usedBackup])

  useEffect(() => {
    mountedRef.current = true
    const generation = sourceGenerationRef.current + 1
    sourceGenerationRef.current = generation
    logger.info(`[useHlsPlayer] URL changed for streamId: ${streamId}`, { initialUrl })

    if (!initialUrl) {
      if (generation === sourceGenerationRef.current) {
        setCurrentUrl(null)
        resetFallbackState()
      }
      return () => {
        sourceGenerationRef.current += 1
      }
    }

    if (generation === sourceGenerationRef.current) {
      setCurrentUrl(initialUrl)
      resetFallbackState()
    }

    return () => {
      if (sourceGenerationRef.current === generation) sourceGenerationRef.current += 1
    }
  }, [initialUrl, resetFallbackState, streamId])

  const setError = useCallback((message: string) => {
    if (!mountedRef.current) return
    logger.error(`[useHlsPlayer] Error set for streamId: ${streamId}`, { message })
    setIsError(true)
    setErrorMessage(message)
  }, [streamId])

  const retry = useCallback((): boolean => {
    if (!mountedRef.current) return false
    const canUseBackup = !usedBackup && Boolean(streamId) && !forceDirectUrl
    const canUseDirect = !forceDirectUrl && Boolean(currentUrl)

    if (!canUseBackup && !canUseDirect) {
      logger.error(`[useHlsPlayer] Retry called for streamId: ${streamId}, but no further fallback is available.`)
      return false
    }

    setRetryCount((count) => count + 1)
    setIsError(false)
    setErrorMessage(null)

    if (canUseBackup) {
      logger.warn(`[useHlsPlayer] Retrying streamId: ${streamId}. Failing over to backup.`)
      setUsedBackup(true)
      setHasFailedOver(true)
      return true
    }

    if (canUseDirect) {
      logger.warn(`[useHlsPlayer] Proxy fallback failed for streamId: ${streamId}. Switching to direct stream URL.`)
      setForceDirectUrl(true)
      setHasFailedOver(true)
      return true
    }

    logger.error(`[useHlsPlayer] Retry called for streamId: ${streamId}, but no further fallback is available.`)
    return false
  }, [currentUrl, forceDirectUrl, streamId, usedBackup])

  useEffect(() => () => {
    mountedRef.current = false
    sourceGenerationRef.current += 1
  }, [])

  return {
    currentUrl: playbackUrl,
    isError,
    errorMessage,
    usedBackup,
    hasFailedOver,
    retryCount,
    setError,
    retry,
    reset: resetFallbackState,
    setCurrentUrl,
  }
}
