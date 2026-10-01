import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type DeviceTier = 'low' | 'medium' | 'high'
export type NetworkQuality = 'slow' | 'medium' | 'fast'

interface NetworkInformationLike {
  effectiveType?: string
  saveData?: boolean
  downlink?: number
  rtt?: number
  addEventListener?: (type: string, listener: EventListener) => void
  removeEventListener?: (type: string, listener: EventListener) => void
}

interface NavigatorWithPerformanceHints extends Navigator {
  deviceMemory?: number
  connection?: NetworkInformationLike
}

export interface PerformanceProfile {
  deviceTier: DeviceTier
  networkQuality: NetworkQuality
  reducedMotion: boolean
  isSmartTV: boolean
  isMobile: boolean
  isAppleDevice: boolean
  supportsBackdropFilter: boolean
  supportsWebGL: boolean
  hardwareConcurrency: number | null
  deviceMemory: number | null
  shouldReduceEffects: boolean
}

export const DEFAULT_PERFORMANCE_PROFILE: PerformanceProfile = {
  deviceTier: 'medium',
  networkQuality: 'fast',
  reducedMotion: false,
  isSmartTV: false,
  isMobile: false,
  isAppleDevice: false,
  supportsBackdropFilter: false,
  supportsWebGL: false,
  hardwareConcurrency: null,
  deviceMemory: null,
  shouldReduceEffects: false,
}

const SMART_TV_PATTERN = /SmartTV|Tizen|WebOSTV|AppleTV|tvOS|NetCast|Roku/i
const MOBILE_PATTERN = /Mobi|Android|iPhone|iPad|iPod/i
const APPLE_PATTERN = /iPhone|iPad|iPod|Macintosh|Mac OS X/i

function getNetworkQuality(connection: NetworkInformationLike | undefined): NetworkQuality {
  const effectiveType = connection?.effectiveType?.toLowerCase() ?? ''
  const downlink = typeof connection?.downlink === 'number' ? connection.downlink : null
  const rtt = typeof connection?.rtt === 'number' ? connection.rtt : null
  const saveData = connection?.saveData === true
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true

  if (!online || saveData) {
    return 'slow'
  }

  const hasNetworkData = Boolean(effectiveType) || downlink !== null || rtt !== null
  if (!hasNetworkData) return 'fast'

  if (
    effectiveType === 'slow-2g'
    || effectiveType === '2g'
    || (downlink !== null && downlink < 1.5)
    || (rtt !== null && rtt >= 700)
  ) {
    return 'slow'
  }

  if (
    effectiveType === '3g'
    || (downlink !== null && downlink < 8)
    || (rtt !== null && rtt >= 250)
  ) {
    return 'medium'
  }

  return 'fast'
}

function getDeviceTier(
  hardwareConcurrency: number | null,
  deviceMemory: number | null,
  isMobile: boolean,
  isSmartTV: boolean,
): DeviceTier {
  if (isSmartTV) {
    return 'medium'
  }

  const hasAnyHardwareInfo = hardwareConcurrency !== null || deviceMemory !== null
  if (!hasAnyHardwareInfo) {
    return 'medium'
  }

  const lowSpecHardware = (hardwareConcurrency !== null && hardwareConcurrency <= 4)
    || (deviceMemory !== null && deviceMemory <= 4)

  const highSpecHardware = (hardwareConcurrency !== null && hardwareConcurrency >= 8)
    && (deviceMemory !== null ? deviceMemory >= 8 : true)

  if (lowSpecHardware) {
    return isMobile ? 'low' : 'low'
  }

  if (highSpecHardware) {
    return 'high'
  }

  return 'medium'
}

function supportsBackdropFilter(): boolean {
  if (typeof window === 'undefined' || typeof CSS === 'undefined' || typeof CSS.supports !== 'function') {
    return false
  }

  return CSS.supports('backdrop-filter: blur(1px)') || CSS.supports('-webkit-backdrop-filter: blur(1px)')
}

function supportsWebGL(): boolean {
  if (typeof document === 'undefined') {
    return false
  }

  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    return Boolean(gl)
  } catch {
    return false
  }
}

function buildPerformanceProfile(): PerformanceProfile {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return DEFAULT_PERFORMANCE_PROFILE
  }

  const userAgent = navigator.userAgent || ''
  const isMobile = MOBILE_PATTERN.test(userAgent)
  const isAppleDevice = APPLE_PATTERN.test(userAgent)
  const isSmartTV = SMART_TV_PATTERN.test(userAgent)
  const nav = navigator as NavigatorWithPerformanceHints
  const hardwareConcurrency = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null
  const deviceMemory = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null
  const networkQuality = getNetworkQuality(nav.connection)
  const deviceTier = getDeviceTier(hardwareConcurrency, deviceMemory, isMobile, isSmartTV)
  const prefersReducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const reducedMotion = prefersReducedMotion || (deviceTier === 'low' && !isSmartTV)
  const shouldReduceEffects = Boolean(
    reducedMotion || isSmartTV || deviceTier === 'low',
  )

  return {
    deviceTier,
    networkQuality,
    reducedMotion,
    isSmartTV,
    isMobile,
    isAppleDevice,
    supportsBackdropFilter: supportsBackdropFilter(),
    supportsWebGL: supportsWebGL(),
    hardwareConcurrency,
    deviceMemory,
    shouldReduceEffects,
  }
}

function equalsProfile(left: PerformanceProfile, right: PerformanceProfile) {
  return left.deviceTier === right.deviceTier
    && left.networkQuality === right.networkQuality
    && left.reducedMotion === right.reducedMotion
    && left.isSmartTV === right.isSmartTV
    && left.isMobile === right.isMobile
    && left.isAppleDevice === right.isAppleDevice
    && left.supportsBackdropFilter === right.supportsBackdropFilter
    && left.supportsWebGL === right.supportsWebGL
    && left.hardwareConcurrency === right.hardwareConcurrency
    && left.deviceMemory === right.deviceMemory
    && left.shouldReduceEffects === right.shouldReduceEffects
}

const PerformanceProfileContext = createContext<PerformanceProfile>(DEFAULT_PERFORMANCE_PROFILE)

export function PerformanceProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<PerformanceProfile>(() => buildPerformanceProfile())

  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return
    if (typeof window.matchMedia !== 'function') return

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const nav = navigator as NavigatorWithPerformanceHints
    const connection = nav.connection

    const updateProfile = () => {
      const nextProfile = buildPerformanceProfile()
      setProfile((current) => (equalsProfile(current, nextProfile) ? current : nextProfile))
    }

    const handleMediaChange = () => updateProfile()
    const handleConnectionChange = () => updateProfile()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleMediaChange)
    } else {
      mediaQuery.addListener(handleMediaChange)
    }

    if (connection) {
      connection.addEventListener?.('change', handleConnectionChange)
      connection.addEventListener?.('online', handleConnectionChange)
      connection.addEventListener?.('offline', handleConnectionChange)
    }

    window.addEventListener('online', handleConnectionChange)
    window.addEventListener('offline', handleConnectionChange)

    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', handleMediaChange)
      } else {
        mediaQuery.removeListener(handleMediaChange)
      }

      if (connection) {
        connection.removeEventListener?.('change', handleConnectionChange)
        connection.removeEventListener?.('online', handleConnectionChange)
        connection.removeEventListener?.('offline', handleConnectionChange)
      }

      window.removeEventListener('online', handleConnectionChange)
      window.removeEventListener('offline', handleConnectionChange)
    }
  }, [])

  const value = useMemo(() => profile, [profile])

  return createElement(PerformanceProfileContext.Provider, { value }, children)
}

export function usePerformanceProfile() {
  return useContext(PerformanceProfileContext)
}
