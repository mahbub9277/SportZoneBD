import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/Select'

interface QualityPreset {
  value: string
  /** Subtle resolution badge used for the UHD presets. */
  badge?: string
}

/**
 * Stream quality is stored as a free-form string, so these are convenience values for that same
 * field. Selecting one never replaces the manual quality input, it only fills it in.
 */
const QUALITY_PRESETS: readonly QualityPreset[] = [
  { value: '240p' },
  { value: '360p' },
  { value: '480p' },
  { value: '500p+' },
  { value: '720p' },
  { value: '1080p' },
  { value: '1440p', badge: '2K' },
  { value: '2160p', badge: '4K' },
]

interface QualityPresetSelectProps {
  /** Current quality value, so the control always reflects the field it fills. */
  value?: string
  onSelect: (quality: string) => void
  disabled?: boolean
}

/**
 * Compact quality preset picker shown next to the manual quality input. It writes into the existing
 * quality field, so the form keeps a single source of truth and the existing update path is used.
 */
export function QualityPresetSelect({ value, onSelect, disabled = false }: QualityPresetSelectProps) {
  const matchedPreset = QUALITY_PRESETS.find((preset) => preset.value === value)?.value ?? ''

  return (
    <Select value={matchedPreset} onValueChange={onSelect} disabled={disabled}>
      <SelectTrigger aria-label="Quality presets" className="h-11 w-28 shrink-0">
        <SelectValue placeholder="Preset">{matchedPreset}</SelectValue>
      </SelectTrigger>
      <SelectContent className="w-40">
        {QUALITY_PRESETS.map((preset) => (
          <SelectItem key={preset.value} value={preset.value} className="pl-8">
            <span className="flex w-full items-center justify-between gap-2">
              <span>{preset.value}</span>
              {preset.badge ? (
                <span className="rounded-md border border-(--accent)/40 bg-(--accent)/10 px-1.5 py-0.5 text-[10px] font-semibold text-(--accent)">
                  {preset.badge}
                </span>
              ) : null}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
