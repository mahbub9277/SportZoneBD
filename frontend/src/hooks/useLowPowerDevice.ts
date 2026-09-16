import { useEffect, useState } from 'react'

export type NetworkQuality = 'slow' | 'medium' | 'fast'

interface NetworkInformationLike {
  effectiveType?: string
  saveData?: boolean
  downlink?: number
  rtt?: number
  addEventListener?: (type: string, listener: EventListener) => void
  removeEventListener?: (type: string, listener: EventListener) => void
}

interface BatteryManagerLike {
  level: number
  charging: boolean
  addEventListener?: (type: string, listener: EventListener) => void
  removeEventListener?: (type: string, listener: EventListener) => void
}

interface NavigatorWithPerformanceHints extends Navigator {
  deviceMemory?: number
  connection?: NetworkInformationLike
  getBattery?: () => Promise<BatteryManagerLike>
}

export interface DeviceProfile {
  isLowPower: boolean
  reducedMotion: boolean
  networkQuality: NetworkQuality
}

const DEFAULT_PROFILE: DeviceProfile = {
  isLowPower: false,
  reducedMotion: false,
  networkQuality: 'fast',
}

const SMART_TV_PATTERN = /SmartTV|Tizen|WebOSTV|AppleTV|tvOS|NetCast|Roku/i
const LOW_POWER_CPU_CORES = 4
const LOW_POWER_MEMORY_GB = 4
const LOW_POWER_BATTERY_LEVEL = 0.2

function getNetworkQuality(connection: NetworkInformationLike | undefined): NetworkQuality {
  const effectiveType = connection?.effectiveType?.toLowerCase() ?? ''
  const downlink = typeof connection?.downlink === 'number' ? connection.downlink : null
  const rtt = typeof connection?.rtt === 'number' ? connection.rtt : null
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

const addMediaQueryListener = (mediaQuery: MediaQueryList, handler: () => void) => {
  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handler)
    return
  }

  mediaQuery.addListener(handler)
}

const removeMediaQueryListener = (mediaQuery: MediaQueryList, handler: () => void) => {
  if (typeof mediaQuery.removeEventListener === 'function') {
    mediaQuery.removeEventListener('change', handler)
    return
  }

  mediaQuery.removeListener(handler)
}

function isLikelyMobile(userAgent: string) {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(userAgent)
}

/**
 * Detect low-power devices and weak network conditions so the player can reduce load and motion.
 */
export function useLowPowerDevice() {
  const [profile, setProfile] = useState<DeviceProfile>(DEFAULT_PROFILE)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const nav = navigator as NavigatorWithPerformanceHints
    const connection = nav.connection
    const userAgent = navigator.userAgent || ''
    const isMobile = isLikelyMobile(userAgent)
    const hasNetworkData = Boolean(connection)

    let battery: BatteryManagerLike | null = null
    let isActive = true

    const isSameProfile = (left: DeviceProfile, right: DeviceProfile) => (
      left.isLowPower === right.isLowPower
      && left.reducedMotion === right.reducedMotion
      && left.networkQuality === right.networkQuality
    )

    const getDeviceProfile = (): DeviceProfile => {
      const isSmartTv = SMART_TV_PATTERN.test(userAgent)
      const cores = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null
      const memory = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null
      const lowSpecHardware = (cores !== null && cores <= LOW_POWER_CPU_CORES) || (memory !== null && memory <= LOW_POWER_MEMORY_GB)
      const networkQuality = getNetworkQuality(connection)
      const hasDataSaver = connection?.saveData === true
      const batteryConstrained = Boolean(battery && !battery.charging && battery.level <= LOW_POWER_BATTERY_LEVEL)
      const offline = !navigator.onLine
      const weakNetwork = networkQuality === 'slow' || hasDataSaver || offline

      const isLowPower = Boolean(
        isSmartTv
        || batteryConstrained
        || weakNetwork
        || (isMobile && (networkQuality === 'medium' || lowSpecHardware))
      )

      const reducedMotion = mediaQuery.matches || isLowPower

      return {
        isLowPower,
        reducedMotion,
        networkQuality,
      }
    }

    const update = () => {
      if (!isActive) return

      const nextProfile = getDeviceProfile()
      setProfile((previous) => (isSameProfile(previous, nextProfile) ? previous : nextProfile))
    }

    update()

    const handleMediaChange = () => update()
    const handleConnectionChange = () => update()

    addMediaQueryListener(mediaQuery, handleMediaChange)

    if (hasNetworkData) {
      connection?.addEventListener?.('change', handleConnectionChange)
      connection?.addEventListener?.('online', handleConnectionChange)
      connection?.addEventListener?.('offline', handleConnectionChange)
    }

    if (nav.getBattery) {
      void nav.getBattery()
        .then((batteryManager) => {
          if (!isActive) return

          battery = batteryManager
          batteryManager.addEventListener?.('chargingchange', handleConnectionChange)
          batteryManager.addEventListener?.('levelchange', handleConnectionChange)
          update()
        })
        .catch(() => undefined)
    }

    return () => {
      isActive = false
      removeMediaQueryListener(mediaQuery, handleMediaChange)

      if (hasNetworkData) {
        connection?.removeEventListener?.('change', handleConnectionChange)
        connection?.removeEventListener?.('online', handleConnectionChange)
        connection?.removeEventListener?.('offline', handleConnectionChange)
      }

      battery?.removeEventListener?.('chargingchange', handleConnectionChange)
      battery?.removeEventListener?.('levelchange', handleConnectionChange)
    }
  }, [])

  return profile
}
