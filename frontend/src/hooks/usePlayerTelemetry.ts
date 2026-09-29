import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSocket } from './useSocket'

type TelemetryEventType = 'load_start' | 'playing' | 'buffering_start' | 'buffering_end' | 'stalled' | 'fatal_error' | 'network_error' | 'media_error' | 'bitrate_switch' | 'heartbeat' | 'ended' | 'player_destroyed'

const HEARTBEAT_INTERVAL_MS = 90_000
const TELEMETRY_FLUSH_INTERVAL_MS = 30_000
const MAX_BATCH_SIZE = 8

interface PlayerTelemetryOptions {
  streamId?: string
  channelId?: string
  matchId?: string
  active: boolean
}

function createId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function usePlayerTelemetry({ streamId, channelId, matchId, active }: PlayerTelemetryOptions) {
  const { telemetryEnabled: appTelemetryEnabled } = useSocket()
  const telemetryEnabled = appTelemetryEnabled === true
  const enabledRef = useRef(telemetryEnabled)
  const [sessionId] = useState(createId)
  const sessionIdRef = useRef(sessionId)
  const identityRef = useRef(`${streamId ?? ''}|${channelId ?? ''}|${matchId ?? ''}`)
  const queueRef = useRef<Record<string, unknown>[]>([])
  const lastEventTypeRef = useRef<TelemetryEventType | null>(null)
  const terminalEventRef = useRef<TelemetryEventType | null>(null)
  const streamIdRef = useRef(streamId)
  const channelIdRef = useRef(channelId)
  const matchIdRef = useRef(matchId)

  useEffect(() => {
    streamIdRef.current = streamId
    channelIdRef.current = channelId
    matchIdRef.current = matchId
  }, [channelId, matchId, streamId])

  useLayoutEffect(() => {
    enabledRef.current = telemetryEnabled
  }, [telemetryEnabled])

  const flush = useCallback((useBeacon = false) => {
    if (!enabledRef.current) {
      queueRef.current = []
      return
    }
    const events = queueRef.current.splice(0, MAX_BATCH_SIZE)
    if (events.length === 0) return
    const body = JSON.stringify(events)
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon('/api/v1/analytics/telemetry/events', new Blob([body], { type: 'application/json' }))
    } else {
      void fetch('/api/v1/analytics/telemetry/events', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined)
    }
  }, [])

  const track = useCallback((eventType: TelemetryEventType, metadata?: Record<string, string | number | boolean | null>) => {
    if (!telemetryEnabled || !enabledRef.current) return
    const currentStreamId = streamIdRef.current
    const currentChannelId = channelIdRef.current
    const currentMatchId = matchIdRef.current

    if (!currentStreamId && !currentChannelId && !currentMatchId) return

    if (eventType === 'ended' || eventType === 'player_destroyed') {
      if (terminalEventRef.current === eventType) return
      terminalEventRef.current = eventType
    } else if (eventType !== 'heartbeat' && eventType === lastEventTypeRef.current) {
      return
    }

    lastEventTypeRef.current = eventType
    queueRef.current.push({
      eventId: createId(),
      sessionId: sessionIdRef.current,
      eventType,
      timestamp: Date.now(),
      ...(currentStreamId ? { streamId: currentStreamId } : {}),
      ...(currentChannelId ? { channelId: currentChannelId } : {}),
      ...(currentMatchId ? { matchId: currentMatchId } : {}),
      ...(metadata ? { metadata } : {}),
    })
    if (queueRef.current.length >= MAX_BATCH_SIZE) flush()
  }, [flush, telemetryEnabled])

  useEffect(() => {
    const identity = `${streamId ?? ''}|${channelId ?? ''}|${matchId ?? ''}`
    if (identityRef.current !== identity) {
      flush(true)
      sessionIdRef.current = createId()
      identityRef.current = identity
      lastEventTypeRef.current = null
      terminalEventRef.current = null
    }
  }, [channelId, flush, matchId, streamId])

  useLayoutEffect(() => {
    if (!active || !telemetryEnabled) return
    track('heartbeat')
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') track('heartbeat')
    }, HEARTBEAT_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [active, telemetryEnabled, track])

  useLayoutEffect(() => {
    if (!telemetryEnabled) {
      queueRef.current = []
      return
    }
    const timer = window.setInterval(() => {
      if (queueRef.current.length > 0) flush()
    }, TELEMETRY_FLUSH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [telemetryEnabled, flush])

  useEffect(() => () => {
    flush(true)
  }, [flush])

  return { sessionId, track, flush }
}