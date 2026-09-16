import { useEffect, useMemo, useState } from 'react'

const subscribers = new Set<React.Dispatch<React.SetStateAction<number>>>()
let ticker: number | null = null

const stopTicker = () => {
  if (ticker !== null && subscribers.size === 0) {
    window.clearInterval(ticker)
    ticker = null
  }
}

const subscribeToTicker = (setNow: React.Dispatch<React.SetStateAction<number>>) => {
  subscribers.add(setNow)
  if (ticker === null) {
    ticker = window.setInterval(() => {
      const timestamp = Date.now()
      subscribers.forEach((subscriber) => subscriber(timestamp))
    }, 1000)
  }
  return () => {
    subscribers.delete(setNow)
    stopTicker()
  }
}

export interface CountdownSnapshot {
  secondsRemaining: number
  isStarted: boolean
  isExpired: boolean
  formatted: string
  elapsedSeconds: number
  elapsedFormatted: string
}

export function useCountdown(targetIsoDate?: string | Date | null): CountdownSnapshot {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!targetIsoDate) {
      return undefined
    }

    return subscribeToTicker(setNow)
  }, [targetIsoDate])

  return useMemo<CountdownSnapshot>(() => {
    const target = targetIsoDate ? new Date(targetIsoDate).getTime() : NaN

    if (!Number.isFinite(target)) {
      return {
        secondsRemaining: 0,
        isStarted: false,
        isExpired: true,
        formatted: '00:00:00',
        elapsedSeconds: 0,
        elapsedFormatted: '00:00:00',
      }
    }

    const signedSeconds = Math.round((target - now) / 1000)
    const secondsRemaining = Math.max(0, signedSeconds)
    const elapsedSeconds = Math.max(0, Math.round((now - target) / 1000))
    const formatDuration = (totalSeconds: number) => {
      const hours = Math.floor(totalSeconds / 3600)
      const minutes = Math.floor((totalSeconds % 3600) / 60)
      const seconds = totalSeconds % 60
      return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
    }

    if (secondsRemaining <= 0) {
      return {
        secondsRemaining: 0,
        isStarted: true,
        isExpired: true,
        formatted: '00:00:00',
        elapsedSeconds,
        elapsedFormatted: formatDuration(elapsedSeconds),
      }
    }

    return {
      secondsRemaining,
      isStarted: false,
      isExpired: false,
      formatted: formatDuration(secondsRemaining),
      elapsedSeconds,
      elapsedFormatted: formatDuration(elapsedSeconds),
    }
  }, [now, targetIsoDate])
}
