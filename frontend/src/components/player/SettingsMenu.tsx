import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Lock, Settings } from 'lucide-react'
import { Button, type ButtonProps } from '../ui/Button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip'
import { cn } from '../../lib/utils'

export interface PlayerQualityLevel {
  height: number
  bitrate: number
  hlsIndex: number
}

export interface PlayerSubtitleChoice {
  srcLang: string
  label: string
}

interface SettingsMenuProps {
  buttonRef: React.RefObject<HTMLButtonElement | null>
  menuRef: React.RefObject<HTMLDivElement | null>
  isOpen: boolean
  activeSection: 'root' | 'quality' | 'playback' | 'captions'
  qualityLevels: PlayerQualityLevel[]
  currentLevel: number
  playbackRate: number
  playbackRates: number[]
  subtitleChoices: PlayerSubtitleChoice[]
  selectedSubtitleLanguage: string | null
  onToggle: () => void
  onSectionChange: (section: SettingsMenuProps['activeSection']) => void
  onQualityChange: (level: number) => void
  onPlaybackRateChange: (rate: number) => void
  onSubtitleChange: (language: string | null) => void
  onLock: (event: React.MouseEvent<HTMLElement>) => void
}

interface PlayerButtonProps extends ButtonProps {
  tooltip: string
  children: React.ReactNode
}

const PlayerButton = React.forwardRef<HTMLButtonElement, PlayerButtonProps>(({ tooltip, children, ...props }, ref) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button ref={ref} type="button" {...props}>{children}</Button>
    </TooltipTrigger>
    <TooltipContent><p>{tooltip}</p></TooltipContent>
  </Tooltip>
))
PlayerButton.displayName = 'SettingsButton'

export function SettingsMenu({
  buttonRef,
  menuRef,
  isOpen,
  activeSection,
  qualityLevels,
  currentLevel,
  playbackRate,
  playbackRates,
  subtitleChoices,
  selectedSubtitleLanguage,
  onToggle,
  onSectionChange,
  onQualityChange,
  onPlaybackRateChange,
  onSubtitleChange,
  onLock,
}: SettingsMenuProps) {
  const currentQuality = qualityLevels.find((level) => level.hlsIndex === currentLevel)
  const sectionLabel = activeSection === 'quality' ? 'Quality' : activeSection === 'playback' ? 'Playback speed' : 'Captions'

  return (
    <div className="relative">
      <PlayerButton
        ref={buttonRef}
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0 rounded-full border border-white/10 bg-white/5 text-white/80 shadow-sm transition-all duration-200 hover:border-white/20 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 sm:h-9 sm:w-9"
        onClick={(event) => { event.stopPropagation(); onToggle() }}
        tooltip="Settings"
        aria-label="Playback settings"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <Settings className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
      </PlayerButton>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="absolute right-0 bottom-full z-50 mb-2 max-h-[min(58dvh,18rem)] w-[min(17rem,calc(100vw-2rem))] touch-pan-y overflow-y-auto overscroll-contain rounded-2xl border border-white/12 bg-black/80 p-2 text-sm text-white shadow-[0_18px_54px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:mb-2 sm:w-64 sm:max-h-[min(70vh,30rem)] sm:p-3"
            role="menu"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex items-center gap-2 border-b border-white/10 pb-2 sm:hidden">
              <span className="mx-auto h-1 w-10 rounded-full bg-white/25" />
            </div>

            {activeSection !== 'root' && (
              <button
                type="button"
                className="mb-2 flex min-h-10 w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left font-medium text-white/85 transition hover:border-white/20 hover:bg-white/8"
                onClick={() => onSectionChange('root')}
                aria-label="Back to settings"
              >
                <span>Back</span>
                <span className="text-xs uppercase tracking-[0.12em] text-white/45">{sectionLabel}</span>
              </button>
            )}

            {activeSection === 'root' && (
              <div className="space-y-1">
                <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
                  Settings
                </div>

                <SettingsRow
                  label="Quality"
                  value={qualityLevels.length ? (currentQuality ? `${currentQuality.height}p` : 'Auto') : 'Unavailable'}
                  onClick={() => onSectionChange('quality')}
                />
                <SettingsRow
                  label="Playback speed"
                  value={`${playbackRate}x`}
                  onClick={() => onSectionChange('playback')}
                />
                <SettingsRow
                  label="Captions"
                  value={subtitleChoices.length ? (selectedSubtitleLanguage || 'Off') : 'Unavailable'}
                  disabled={!subtitleChoices.length}
                  onClick={() => onSectionChange('captions')}
                />

                <button
                  type="button"
                  className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-white/75 transition hover:bg-white/8 hover:text-white"
                  onClick={onLock}
                  aria-label="Lock screen"
                >
                  <Lock className="h-4 w-4 text-white/60" />
                  <span>Lock screen</span>
                </button>
              </div>
            )}

            {activeSection === 'quality' && (
              <div className="space-y-1">
                {qualityLevels.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-white/45">Quality unavailable</p>
                ) : (
                  <>
                    <MenuOption label="Auto" selected={currentLevel === -1} onClick={() => onQualityChange(-1)} />
                    {qualityLevels.map((level) => (
                      <MenuOption
                        key={`${level.height}-${level.hlsIndex}`}
                        label={`${level.height}p`}
                        selected={currentLevel === level.hlsIndex}
                        onClick={() => onQualityChange(level.hlsIndex)}
                      />
                    ))}
                  </>
                )}
              </div>
            )}

            {activeSection === 'playback' && (
              <div className="space-y-1">
                {playbackRates.map((rate) => (
                  <MenuOption
                    key={rate}
                    label={`${rate}x${rate === 1 ? ' (Normal)' : ''}`}
                    selected={playbackRate === rate}
                    onClick={() => onPlaybackRateChange(rate)}
                  />
                ))}
              </div>
            )}

            {activeSection === 'captions' && (
              <div className="space-y-1">
                <MenuOption label="Off" selected={!selectedSubtitleLanguage} onClick={() => onSubtitleChange(null)} />
                {subtitleChoices.map((track) => (
                  <MenuOption
                    key={track.srcLang}
                    label={track.label || track.srcLang}
                    selected={selectedSubtitleLanguage === track.srcLang}
                    onClick={() => onSubtitleChange(track.srcLang)}
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function SettingsRow({ label, value, icon, disabled, onClick }: { label: string; value?: string; icon?: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="flex min-h-10 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-white/70 transition enabled:hover:bg-white/8 enabled:hover:text-white disabled:cursor-not-allowed disabled:text-white/35"
      onClick={onClick}
    >
      <span>{label}</span>
      {icon || <span className="text-white/55">{value}</span>}
    </button>
  )
}

function MenuOption({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={cn(
        'flex min-h-10 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-white/75 transition hover:bg-white/8 hover:text-white',
        selected && 'bg-white/10 font-semibold text-white',
      )}
      onClick={onClick}
      role="menuitemradio"
      aria-checked={selected}
    >
      <span>{label}</span>
      {selected && <Check className="h-4 w-4 text-cyan-300" />}
    </button>
  )
}