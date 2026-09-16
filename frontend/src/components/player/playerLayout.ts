import { cn } from '../../lib/utils'

export function getPlayerContainerClass({ compact, fullscreen }: { compact: boolean; fullscreen: boolean }) {
  return cn(
    compact && 'mini-player-controls',
    'premium-border group relative mx-auto w-full overflow-hidden rounded-2xl border border-white/12 bg-black shadow-[0_18px_56px_rgba(0,0,0,0.48)] ring-1 ring-[#0474C4]/20 transition-[max-width,transform] duration-300 touch-manipulation',
    compact ? 'aspect-video min-h-0 max-h-[min(42vh,260px)]' : 'aspect-video min-h-55 sm:min-h-75 md:min-h-90 lg:min-h-105',
    compact ? 'max-w-full' : 'max-w-full sm:max-w-[72vw] md:max-w-[74vw] lg:max-w-[76vw]',
    fullscreen && 'h-dvh max-w-none scale-100 rounded-none border-none shadow-none ring-0',
  )
}