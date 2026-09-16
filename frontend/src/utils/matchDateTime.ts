const MATCH_TIME_ZONE = 'Asia/Dhaka'

type DateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number }

const getParts = (instant: Date): DateParts | null => {
  if (Number.isNaN(instant.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MATCH_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, Number(value)]))
  if (![values.year, values.month, values.day, values.hour, values.minute, values.second].every(Number.isFinite)) return null
  return values as DateParts
}

const getTimeZoneOffsetMinutes = (instant: Date): number => {
  const parts = getParts(instant)
  if (!parts) return 0
  return (Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - instant.getTime()) / 60000
}

export const parseMatchDateTime = (date: string, time: string): string | null => {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const timeMatch = time.match(/^(\d{2}):(\d{2})$/)
  if (!match || !timeMatch) return null
  const [, year, month, day] = match
  const [, hour, minute] = timeMatch
  const localAsUtc = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)))
  if (getParts(localAsUtc) === null) return null
  const instant = new Date(localAsUtc.getTime() - getTimeZoneOffsetMinutes(localAsUtc) * 60000)
  const check = getParts(instant)
  if (!check || check.year !== Number(year) || check.month !== Number(month) || check.day !== Number(day) || check.hour !== Number(hour) || check.minute !== Number(minute)) return null
  return instant.toISOString()
}

export const formatMatchDateTimeInput = (value?: string | null): string => {
  if (!value) return ''
  const parts = getParts(new Date(value))
  if (!parts) return ''
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
}

export const formatMatchKickoffTime = (value?: string | null): string => {
  const parts = value ? getParts(new Date(value)) : null
  if (!parts) return '--:--'
  const hour = parts.hour % 12 || 12
  return `${String(hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')} ${parts.hour >= 12 ? 'PM' : 'AM'}`
}

export const formatMatchKickoffDate = (value?: string | null): string => {
  const parts = value ? getParts(new Date(value)) : null
  if (!parts) return '--/--/----'
  return `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}/${parts.year}`
}

export const formatMatchKickoff = (value?: string | null): string => `${formatMatchKickoffTime(value)} · ${formatMatchKickoffDate(value)}`

export const getMatchTimeZone = () => MATCH_TIME_ZONE