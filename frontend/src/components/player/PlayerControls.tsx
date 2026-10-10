import React from 'react'
import { CirclePlay, Maximize, Minimize, Pause, PictureInPicture2, Play, RefreshCw, RotateCcw, RotateCw, Settings, Volume1, Volume2, VolumeX } from 'lucide-react'
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
  compactControls: boolean
  /**
   * Seconds of media the browser currently holds for the active source. Live and duration-less HLS
   * playback shows this instead of a duration it cannot know.
   */
  bufferedAmount?: number
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
  /** True while a retry is already running, so the refresh affordance cannot stack attempts. */
  isRetrying?: boolean
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

// The bottom bar is the primary control surface. Its buttons are sized about 2% above the previous
// 2.25rem so the row feels slightly more comfortable without changing the design language.
const buttonClass = 'inline-flex h-[2.3rem] w-[2.3rem] shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 shadow-sm transition hover:border-white/20 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/45 disabled:cursor-not-allowed disabled:opacity-40'
const glassClass = 'border border-white/12 bg-black/35 shadow-[0_14px_36px_rgba(0,0,0,0.28)] backdrop-blur-xl'
// Inside the fixed mini card the bar is nearly opaque already, so the blur (and its per-frame
// compositing cost over playing video) is dropped in favour of a flat translucent fill.
const compactGlassClass = 'border border-white/12 bg-[#080B15]/65 shadow-[0_10px_28px_rgba(0,0,0,0.32)]'
// The transport controls live over the video, so they stay deliberately light: a soft translucent
// fill that reads clearly against both live video and bright highlight frames. The glyph stays 15px
// while the button grows and gains an invisible 5px halo, so the tap target is comfortable without a
// heavier visual footprint.
const transportButtonClass = 'relative inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/18 bg-black/35 text-white/90 shadow-[0_10px_26px_rgba(0,0,0,0.3)] backdrop-blur-md transition after:absolute after:-inset-2 after:rounded-full after:content-[""] hover:border-white/30 hover:bg-black/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 motion-safe:hover:scale-105 motion-safe:active:scale-95 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-40 sm:h-13 sm:w-13'
// Only the transport buttons opt into pointer events, and only while the overlay is actually shown.
const transportVisibilityClass = (visible: boolean) => visible
  ? 'opacity-100 [&_button]:pointer-events-auto'
  : 'pointer-events-none opacity-0 [&_button]:pointer-events-none'

export function PlayerControls({
  isPlaying, isMuted, volume, played, duration, progressRatio, isFullscreen, hasError, controlsVisible, isSettingsOpen,
  activeSettingsSection, playbackRate, subtitlesEnabled, isPiPSupported, isPiPActive, compactControls,
  bufferedAmount = 0,
  liveWindow, qualityLevels, currentLevel, playbackRates, subtitleChoices, selectedSubtitleLanguage,
  settingsButtonRef, settingsMenuRef, volumeContainerRef, onPlayPause, onVolumeButtonClick,
  onVolumeKeyDown, onVolumeChange, onSeekMouseDown, onSeekChange, onSeekMouseUp,
  onSeekBackward, onSeekForward, showSeekControls = false, onSettingsToggle, onSettingsSectionChange,
  onQualityChange, onPlaybackRateChange, onSubtitleChange, onToggleSubtitles, onLock, onPiPToggle,
  onFullscreenToggle, onRetry, isRetrying = false, onSurfaceClick, onSurfaceDoubleClick, onMouseMove, onMouseEnter,
  matchMetadata,
}: PlayerControlsProps) {
  const displayCurrentTime = Number.isFinite(played) ? Math.max(0, played) : Number.isFinite(liveWindow.currentTime) ? Math.max(0, liveWindow.currentTime) : 0
  const hasKnownDuration = Number.isFinite(duration) && duration > 0 && duration !== Infinity
  // A meaningful loaded amount is at least a second long: anything shorter would render as "0:00".
  const hasKnownBufferedAmount = Number.isFinite(bufferedAmount) && bufferedAmount >= 1
  // A live stream has no total duration, so the loaded amount is shown in its place. The same applies
  // to an HLS source whose duration is not (yet) exposed, instead of an unavailable "--:--".
  const loadedLabel = hasKnownBufferedAmount ? formatTime(bufferedAmount) : null
  const timeLabel = liveWindow.isLive
    ? `${formatTime(displayCurrentTime)} / ${loadedLabel ?? 'LIVE'}`
    : `${formatTime(displayCurrentTime)} / ${hasKnownDuration ? formatDuration(duration) : loadedLabel ?? '--:--'}`
  const showSideControls = controlsVisible || isSettingsOpen
  // The transport controls live over the video; they follow the same visibility rules as the bar so
  // the overlay never becomes permanent UI while the player is running.
  const showTransportControls = controlsVisible && !hasError && !compactControls
  const volumeLabel = isMuted ? 'Unmute' : 'Mute'

  const stopControlPropagation = (event: React.SyntheticEvent) => {
    event.stopPropagation()
  }

  return (
    <div className={`absolute inset-0 ${hasError ? 'z-40' : 'z-20'}`} onClick={onSurfaceClick} onDoubleClick={onSurfaceDoubleClick} onMouseMove={onMouseMove} onMouseEnter={onMouseEnter}>
      <AnimatePresence>
        {controlsVisible && !compactControls && matchMetadata && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="absolute inset-x-3 top-3 sm:inset-x-5 sm:top-5">
            <MatchHeader metadata={matchMetadata} />
          </motion.div>
        )}
      </AnimatePresence>

      {!compactControls && <div className={`${glassClass} absolute right-2 top-1/2 z-30 hidden -translate-y-1/2 flex-col items-center gap-1 rounded-2xl p-1 transition-opacity duration-200 lg:right-3 lg:flex lg:p-1.5 ${showSideControls ? 'opacity-100' : 'pointer-events-none opacity-0'}`} onClick={stopControlPropagation}>
        <div className="my-1 h-px w-5 bg-white/10" />
        <RailButton label={volumeLabel} icon={isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />} onClick={(event) => onVolumeButtonClick(event)} />
        <div className="flex h-24 items-center justify-center py-1">
          <input aria-label="Volume" type="range" min="0" max="1" step="0.01" value={isMuted ? 0 : volume} onChange={(event) => onVolumeChange(Number(event.currentTarget.value))} onKeyDown={onVolumeKeyDown} className="h-1 w-16 -rotate-90 accent-[#0474C4]" />
        </div>
        <RailButton label="Settings" icon={<Settings className="h-4 w-4" />} onClick={onSettingsToggle} />
        <RailButton label={isPiPActive ? 'Exit picture-in-picture' : 'Picture-in-picture'} icon={<PictureInPicture2 className="h-4 w-4" />} onClick={onPiPToggle} disabled={!isPiPSupported} />
      </div>}

      {/* The centre overlay now holds only the optional skip shortcuts: play/pause lives in the control
          bar, so it is no longer duplicated over the video. */}
      <div
        className={`pointer-events-none absolute inset-0 z-30 flex items-center justify-center gap-5 px-4 transition-opacity duration-200 motion-reduce:transition-none sm:gap-6 ${transportVisibilityClass(showTransportControls)}`}
        aria-hidden={!showTransportControls}
        onClick={stopControlPropagation}
        onDoubleClick={stopControlPropagation}
      >
        {showSeekControls && (
          <button type="button" className={transportButtonClass} onClick={onSeekBackward} tabIndex={showTransportControls ? 0 : -1} aria-label="Rewind 5 seconds" title="Rewind 5 seconds">
            <TransportGlyph icon={<RotateCcw className="h-6.25 w-6.25" aria-hidden="true" />} badge="5" />
          </button>
        )}
        {showSeekControls && (
          <button type="button" className={transportButtonClass} onClick={onSeekForward} tabIndex={showTransportControls ? 0 : -1} aria-label="Skip forward 10 seconds" title="Skip forward 10 seconds">
            <TransportGlyph icon={<RotateCw className="h-6.25 w-6.25" aria-hidden="true" />} badge="10" />
          </button>
        )}
      </div>

      <div className={`absolute inset-x-0 bottom-0 transition-opacity duration-200 ${controlsVisible || !isPlaying ? 'opacity-100' : 'pointer-events-none opacity-0'}`} onClick={stopControlPropagation}>
        <div className={`h-8 bg-linear-to-t from-[#080B15]/95 to-transparent pt-4 ${compactControls ? 'px-2' : 'px-4 sm:px-5'}`}><div className="relative h-1.5 rounded-full bg-white/15"><div className="absolute inset-y-0 left-0 rounded-full bg-white/25" style={{ width: `${Math.min(100, progressRatio * 100 + 10)}%` }} /><div className="absolute inset-y-0 left-0 rounded-full bg-[#0474C4]" style={{ width: `${progressRatio * 100}%` }} /><input aria-label="Seek video" type="range" min="0" max="1" step="0.001" value={progressRatio} onMouseDown={onSeekMouseDown} onChange={onSeekChange} onMouseUp={onSeekMouseUp} className="absolute inset-x-0 -top-2 h-5 w-full cursor-pointer opacity-0" /></div></div>
        <div className={`${compactControls ? compactGlassClass : glassClass} flex flex-wrap items-center border-x-0 border-b-0 ${compactControls ? 'min-h-[3.2rem] gap-1 px-2 py-1.5' : 'min-h-[3.57rem] gap-1.5 px-3 py-2 sm:gap-3 sm:px-5'}`}>
          {compactControls && (
            <button type="button" className={`${buttonClass} h-10 w-10`} onClick={onPlayPause} aria-label={isPlaying ? 'Pause' : 'Play'} title={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? <Pause className="h-4 w-4" /> : <CirclePlay className="h-5 w-5" />}</button>
          )}
          {!compactControls && (
            <button type="button" className={buttonClass} onClick={onPlayPause} aria-label={isPlaying ? 'Pause' : 'Play'} title={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}</button>
          )}
          <div className="group/volume relative flex shrink-0 items-center" ref={volumeContainerRef}>
            <button type="button" className={buttonClass} onClick={onVolumeButtonClick} aria-label={volumeLabel} title={volumeLabel}>{isMuted ? <VolumeX className="h-4 w-4" /> : volume < 0.5 ? <Volume1 className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}</button>
            <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-36 -translate-x-1/2 rounded-2xl border border-white/12 bg-black/70 p-2.5 opacity-0 shadow-[0_14px_36px_rgba(0,0,0,0.4)] backdrop-blur-xl transition-opacity duration-150 group-hover/volume:pointer-events-auto group-hover/volume:opacity-100 group-focus-within/volume:pointer-events-auto group-focus-within/volume:opacity-100 motion-reduce:transition-none">
              <input aria-label="Volume level" type="range" min="0" max="1" step="0.01" value={isMuted ? 0 : volume} onChange={(event) => onVolumeChange(Number(event.currentTarget.value))} onKeyDown={onVolumeKeyDown} className="h-1.5 w-full cursor-pointer accent-[#0474C4]" />
            </div>
          </div>
          <span className={`shrink-0 whitespace-nowrap text-[10px] font-semibold tabular-nums text-white/65 ${compactControls ? 'min-w-16' : 'min-w-18 sm:min-w-24 sm:text-xs'}`}>{timeLabel}</span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {(!compactControls || subtitleChoices.length > 0) && <button type="button" className={buttonClass} onClick={onToggleSubtitles} disabled={!subtitleChoices.length} aria-label={subtitlesEnabled ? 'Disable captions' : 'Enable captions'} title={subtitlesEnabled ? 'Turn captions off' : 'Turn captions on'}><span className="text-[10px] font-black">CC</span></button>}
            <button type="button" className={buttonClass} onClick={(event) => { event.stopPropagation(); onRetry() }} disabled={isRetrying} aria-busy={isRetrying || undefined} aria-label={hasError ? 'Retry playback' : 'Refresh playback'} title={hasError ? 'Retry playback' : 'Refresh playback'}><RefreshCw className={`h-4 w-4 ${isRetrying ? 'animate-spin motion-reduce:animate-none' : ''}`} /></button>
            {!compactControls && <SettingsMenu buttonRef={settingsButtonRef} menuRef={settingsMenuRef} isOpen={isSettingsOpen} activeSection={activeSettingsSection} qualityLevels={qualityLevels} currentLevel={currentLevel} playbackRate={playbackRate} playbackRates={playbackRates} subtitleChoices={subtitleChoices} selectedSubtitleLanguage={selectedSubtitleLanguage} onToggle={onSettingsToggle} onSectionChange={onSettingsSectionChange} onQualityChange={onQualityChange} onPlaybackRateChange={onPlaybackRateChange} onSubtitleChange={onSubtitleChange} onLock={onLock} />}
            <button type="button" className={buttonClass} onClick={onPiPToggle} disabled={!isPiPSupported} aria-label="Picture-in-picture" title={isPiPActive ? 'Exit picture-in-picture' : 'Picture-in-picture'}><PictureInPicture2 className="h-4 w-4" /></button>
            <button type="button" className={buttonClass} onClick={onFullscreenToggle} aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>{isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}</button>
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

// The seconds indicator sits inside the rotate glyph so the control stays compact and readable.
function TransportGlyph({ icon, badge }: { icon: React.ReactNode; badge: string }) {
  return (
    <span className="relative inline-flex items-center justify-center">
      {icon}
      {/* The interval label sits inside the arrow: bigger than before and with a hairline shadow, so "5"
          and "10" stay readable over a bright video frame. */}
      <span className="absolute text-[11px] font-black leading-none tracking-tight [text-shadow:0_1px_2px_rgba(0,0,0,0.75)]" aria-hidden="true">{badge}</span>
    </span>
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

// Total duration stays unknown until real metadata arrives, so it must never fall back to "0:00".
function formatDuration(value: number) {
  return Number.isFinite(value) && value > 0 ? formatTime(value) : '--:--'
}
