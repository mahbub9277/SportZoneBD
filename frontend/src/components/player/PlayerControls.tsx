import React from 'react'
import { CirclePlay, Expand, Maximize, Minimize, Pause, PictureInPicture2, RefreshCw, Settings, StepBack, StepForward, Volume1, Volume2, VolumeX } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { SettingsMenu, type PlayerQualityLevel, type PlayerSubtitleChoice } from './SettingsMenu'

interface LiveWindowState {
  hasTimeshift: boolean
  liveStart: number
  liveEdge: number
  currentTime: number
  isLive: boolean
}

export interface PlayerControlsProps {
  isPlaying: boolean
  isMuted: boolean
  volume: number
  played: number
  duration: number
  progressRatio: number
  isFullscreen: boolean
  hasError: boolean
  controlsVisible: boolean
  isSettingsOpen: boolean
  activeSettingsSection: 'root' | 'quality' | 'playback' | 'captions'
  playbackRate: number
  subtitlesEnabled: boolean
  isPiPSupported: boolean
  isPiPActive: boolean
  isTouchDevice: boolean
  compactControls: boolean
  liveWindow: LiveWindowState
  qualityLevels: PlayerQualityLevel[]
  currentLevel: number
  playbackRates: number[]
  subtitleChoices: PlayerSubtitleChoice[]
  selectedSubtitleLanguage: string | null
  settingsButtonRef: React.RefObject<HTMLButtonElement | null>
  settingsMenuRef: React.RefObject<HTMLDivElement | null>
  volumeContainerRef: React.RefObject<HTMLDivElement | null>
  onPlayPause: () => void
  onVolumeButtonClick: (event: React.MouseEvent<HTMLElement>) => void
  onVolumeKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
  onVolumeChange: (value: number) => void
  onSeekMouseDown: (event: React.MouseEvent<HTMLInputElement>) => void
  onSeekChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  onSeekMouseUp: (event: React.MouseEvent<HTMLInputElement>) => void
  onSeekBackward: () => void
  onSeekForward: () => void
  showSeekControls?: boolean
  onSettingsToggle: () => void
  onSettingsSectionChange: (section: 'root' | 'quality' | 'playback' | 'captions') => void
  onQualityChange: (level: number) => void
  onPlaybackRateChange: (rate: number) => void
  onSubtitleChange: (language: string | null) => void
  onToggleSubtitles: () => void
  onLock: (event: React.MouseEvent<HTMLElement>) => void
  onPiPToggle: () => void
  onFullscreenToggle: () => void
  onRetry: () => void
  onSurfaceClick: (event: React.MouseEvent<HTMLDivElement>) => void
  onSurfaceDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void
  onMouseMove: () => void
  onMouseEnter: () => void
  matchMetadata?: MatchPlayerMetadata
}

export interface MatchPlayerMetadata {
  homeTeam: { abbreviation: string; logo?: string | null }
  awayTeam: { abbreviation: string; logo?: string | null }
  homeScore?: string | number
  awayScore?: string | number
  timer?: string
}

const buttonClass = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 shadow-sm transition hover:border-white/20 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/45 disabled:cursor-not-allowed disabled:opacity-40'
const glassClass = 'border border-white/12 bg-black/35 shadow-[0_14px_36px_rgba(0,0,0,0.28)] backdrop-blur-xl'

export function PlayerControls({
  isPlaying, isMuted, volume, played, duration, progressRatio, isFullscreen, hasError, controlsVisible, isSettingsOpen,
  activeSettingsSection, playbackRate, subtitlesEnabled, isPiPSupported, isPiPActive, compactControls,
  liveWindow, qualityLevels, currentLevel, playbackRates, subtitleChoices, selectedSubtitleLanguage,
  settingsButtonRef, settingsMenuRef, volumeContainerRef, onPlayPause, onVolumeButtonClick,
  onVolumeKeyDown, onVolumeChange, onSeekMouseDown, onSeekChange, onSeekMouseUp,
  onSeekBackward, onSeekForward, showSeekControls = false, onSettingsToggle, onSettingsSectionChange,
  onQualityChange, onPlaybackRateChange, onSubtitleChange, onToggleSubtitles, onLock, onPiPToggle,
  onFullscreenToggle, onRetry, onSurfaceClick, onSurfaceDoubleClick, onMouseMove, onMouseEnter,
  matchMetadata,
}: PlayerControlsProps) {
  const displayCurrentTime = Number.isFinite(played) ? Math.max(0, played) : Number.isFinite(liveWindow.currentTime) ? Math.max(0, liveWindow.currentTime) : 0
  const displayDuration = Number.isFinite(duration) && duration > 0 && duration !== Infinity ? duration : 0
  const timeLabel = liveWindow.isLive ? 'LIVE' : `${formatTime(displayCurrentTime)} / ${formatTime(displayDuration)}`
  const showSideControls = controlsVisible || isSettingsOpen

  return (
    <div className={`absolute inset-0 ${hasError ? 'z-40' : 'z-20'}`} onClick={onSurfaceClick} onDoubleClick={onSurfaceDoubleClick} onMouseMove={onMouseMove} onMouseEnter={onMouseEnter}>
      <AnimatePresence>
        {controlsVisible && !compactControls && matchMetadata && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="absolute inset-x-3 top-3 sm:inset-x-5 sm:top-5">
            <MatchHeader metadata={matchMetadata} />
          </motion.div>
        )}
      </AnimatePresence>

      {!compactControls && <div className={`${glassClass} absolute right-2 top-1/2 z-30 hidden -translate-y-1/2 flex-col items-center gap-1 rounded-2xl p-1 transition-opacity duration-200 lg:right-3 lg:flex lg:p-1.5 ${showSideControls ? 'opacity-100' : 'pointer-events-none opacity-0'}`} onClick={(event) => event.stopPropagation()}>
        <div className="my-1 h-px w-5 bg-white/10" />
        <RailButton label={isMuted ? 'Unmute' : 'Mute'} icon={isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />} onClick={(event) => onVolumeButtonClick(event)} />
        <div ref={volumeContainerRef} className="flex h-24 items-center justify-center py-1">
          <input aria-label="Volume" type="range" min="0" max="1" step="0.01" value={isMuted ? 0 : volume} onChange={(event) => onVolumeChange(Number(event.currentTarget.value))} onKeyDown={onVolumeKeyDown} className="h-1 w-16 -rotate-90 accent-[#0474C4]" />
        </div>
        <RailButton label="Settings" icon={<Settings className="h-4 w-4" />} onClick={onSettingsToggle} />
        <RailButton label={isPiPActive ? 'Exit picture-in-picture' : 'Picture-in-picture'} icon={<PictureInPicture2 className="h-4 w-4" />} onClick={onPiPToggle} disabled={!isPiPSupported} />
      </div>}

      <div className={`absolute inset-x-0 bottom-0 transition-opacity duration-200 ${controlsVisible || !isPlaying ? 'opacity-100' : 'pointer-events-none opacity-0'}`} onClick={(event) => event.stopPropagation()}>
        <div className="h-8 bg-linear-to-t from-[#080B15]/95 to-transparent px-4 pt-4 sm:px-5"><div className="relative h-1.5 rounded-full bg-white/15"><div className="absolute inset-y-0 left-0 rounded-full bg-white/25" style={{ width: `${Math.min(100, progressRatio * 100 + 10)}%` }} /><div className="absolute inset-y-0 left-0 rounded-full bg-[#0474C4]" style={{ width: `${progressRatio * 100}%` }} /><input aria-label="Seek video" type="range" min="0" max="1" step="0.001" value={progressRatio} onMouseDown={onSeekMouseDown} onChange={onSeekChange} onMouseUp={onSeekMouseUp} className="absolute inset-x-0 -top-2 h-5 w-full cursor-pointer opacity-0" /></div></div>
        <div className={`${glassClass} flex min-h-14 flex-wrap items-center gap-1.5 border-x-0 border-b-0 px-3 py-2 sm:gap-3 sm:px-5`}>
          <button type="button" className={`${buttonClass} h-10 w-10`} onClick={onPlayPause} aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? <Pause className="h-4 w-4" /> : <CirclePlay className="h-5 w-5" />}</button>
          {showSeekControls && (
            <div className="flex items-center gap-1">
              <SeekButton seconds={5} direction="backward" onClick={onSeekBackward} />
              <SeekButton seconds={10} direction="forward" onClick={onSeekForward} />
            </div>
          )}
          <div className="group/volume flex min-w-0 items-center gap-2" ref={volumeContainerRef}>
            <button type="button" className={buttonClass} onClick={onVolumeButtonClick} aria-label={isMuted ? 'Unmute' : 'Mute'}>{isMuted ? <VolumeX className="h-4 w-4" /> : volume < 0.5 ? <Volume1 className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}</button>
            <div className="hidden w-24 items-center group-hover/volume:flex group-focus-within/volume:flex sm:w-28">
              <input aria-label="Volume" type="range" min="0" max="1" step="0.01" value={isMuted ? 0 : volume} onChange={(event) => onVolumeChange(Number(event.currentTarget.value))} onKeyDown={onVolumeKeyDown} className="w-full accent-[#0474C4]" />
            </div>
          </div>
          <span className="min-w-16 whitespace-nowrap text-[10px] font-semibold tabular-nums text-white/65 sm:min-w-24 sm:text-xs">{timeLabel}</span>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" className={buttonClass} onClick={onToggleSubtitles} disabled={!subtitleChoices.length} aria-label={subtitlesEnabled ? 'Disable captions' : 'Enable captions'} title={subtitlesEnabled ? 'Turn captions off' : 'Turn captions on'}><span className="text-[10px] font-black">CC</span></button>
            <button type="button" className={buttonClass} onClick={(event) => { event.stopPropagation(); onRetry() }} aria-label="Retry playback" title={hasError ? 'Retry playback' : 'Refresh playback'}><RefreshCw className="h-4 w-4" /></button>
            <SettingsMenu buttonRef={settingsButtonRef} menuRef={settingsMenuRef} isOpen={isSettingsOpen} activeSection={activeSettingsSection} qualityLevels={qualityLevels} currentLevel={currentLevel} playbackRate={playbackRate} playbackRates={playbackRates} subtitleChoices={subtitleChoices} selectedSubtitleLanguage={selectedSubtitleLanguage} onToggle={onSettingsToggle} onSectionChange={onSettingsSectionChange} onQualityChange={onQualityChange} onPlaybackRateChange={onPlaybackRateChange} onSubtitleChange={onSubtitleChange} onLock={onLock} />
            <button type="button" className={buttonClass} onClick={onPiPToggle} disabled={!isPiPSupported} aria-label="Picture-in-picture" title={isPiPActive ? 'Exit picture-in-picture' : 'Picture-in-picture'}><PictureInPicture2 className="h-4 w-4" /></button>
            <button type="button" className={buttonClass} onClick={onFullscreenToggle} aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>{isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}</button>
            {compactControls && <button type="button" className={buttonClass} onClick={onFullscreenToggle} aria-label="Open full player" title="Open full player"><Expand className="h-4 w-4" /></button>}
          </div>
        </div>
      </div>
    </div>
  )
}

function MatchHeader({ metadata }: { metadata: MatchPlayerMetadata }) {
  return <div className={`${glassClass} flex min-w-0 w-fit items-center gap-2 rounded-full px-2 py-1.5 text-white`}><TeamLogo src={metadata.homeTeam.logo} alt={metadata.homeTeam.abbreviation} /><span className="text-[10px] font-black">{metadata.homeTeam.abbreviation}</span><span className="text-[10px] text-white/40">vs</span><TeamLogo src={metadata.awayTeam.logo} alt={metadata.awayTeam.abbreviation} /><span className="text-[10px] font-black">{metadata.awayTeam.abbreviation}</span>{metadata.homeScore !== undefined && <span className="border-l border-white/15 pl-2 text-[11px] font-black text-white">{metadata.homeScore}-{metadata.awayScore}</span>}{metadata.timer && <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-bold text-white">{metadata.timer}</span>}</div>
}

function TeamLogo({ src, alt }: { src?: string | null; alt: string }) {
  return src ? <img src={src} alt={`${alt} logo`} className="h-5 w-5 rounded-full object-contain" /> : <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[8px] text-white/50">{alt.slice(0, 1)}</span>
}

function SeekButton({ seconds, direction, onClick }: { seconds: number; direction: 'backward' | 'forward'; onClick: () => void }) {
  const label = direction === 'backward' ? `Rewind ${seconds} seconds` : `Skip ${seconds} seconds forward`
  const Icon = direction === 'backward' ? StepBack : StepForward
  return (
    <button type="button" className={`${buttonClass} h-9 min-w-11 gap-0.5 px-2`} onClick={onClick} aria-label={label} title={label}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className="text-[10px] font-black leading-none" aria-hidden="true">{seconds}</span>
    </button>
  )
}

function RailButton({ label, icon, onClick, disabled }: { label: string; icon: React.ReactNode; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void; disabled?: boolean }) {
  return <button type="button" className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 shadow-sm transition hover:border-white/20 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/45 disabled:cursor-not-allowed disabled:opacity-35" onClick={onClick} aria-label={label} title={label} disabled={disabled}>{icon}</button>
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00'
  const totalSeconds = Math.floor(value)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
}
