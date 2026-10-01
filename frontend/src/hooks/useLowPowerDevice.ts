import { usePerformanceProfile, type NetworkQuality } from './usePerformanceProfile'

export type { PerformanceProfile, DeviceTier, NetworkQuality } from './usePerformanceProfile'
export { DEFAULT_PERFORMANCE_PROFILE, PerformanceProvider, usePerformanceProfile } from './usePerformanceProfile'

export interface DeviceProfile {
  isLowPower: boolean
  reducedMotion: boolean
  networkQuality: NetworkQuality
}

export function useLowPowerDevice() {
  const profile = usePerformanceProfile()

  return {
    isLowPower: profile.deviceTier === 'low' || profile.shouldReduceEffects,
    reducedMotion: profile.reducedMotion,
    networkQuality: profile.networkQuality,
  }
}
