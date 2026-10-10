/**
 * The console welcome message.
 *
 * The name is the signed-in user's real display name, the greeting follows their local time of day, and
 * the message is chosen deterministically for the calendar day, so a re-render or a page change cannot
 * swap the wording under the reader. Nothing here claims an achievement: the messages are about the work
 * itself, not about how much of it someone is supposed to have done.
 */

export type DayPart = 'morning' | 'afternoon' | 'evening'

export interface WelcomeMessage {
  greeting: string
  /** The full sentence, ready to render. */
  text: string
  dayPart: DayPart
}

/** The fallback used when an account has no display name, matching the rest of the application. */
export const WELCOME_NAME_FALLBACK = 'there'

const GREETINGS: Record<DayPart, string> = {
  morning: 'Good morning',
  afternoon: 'Good afternoon',
  evening: 'Good evening',
}

/**
 * One message per part of the day, so the wording suits the moment and the same message is never the only
 * one a moderator ever sees.
 */
const MESSAGES: Record<DayPart, readonly string[]> = {
  morning: [
    'Your careful work keeps SportZoneBD safe and reliable. Let’s make today’s moderation count.',
    'Every review you complete helps someone watch without a problem. Thank you for starting the day here.',
    'A steady start makes the whole queue easier. Take each case in order and flag what needs a closer look.',
  ],
  afternoon: [
    'Every thoughtful review helps create a better experience for our community.',
    'Clear decisions and a fair tone are what members notice most. Keep it up.',
    'Thank you for keeping the queue moving. If something needs a second opinion, note it and move on.',
  ],
  evening: [
    'Thank you for closing out the day’s reports carefully. Reliable moderation is a team effort.',
    'Half of good moderation is following through. Anything still open is worth a note before you finish.',
    'Your work today helped keep the platform trustworthy. Leave the queue tidy for the next shift.',
  ],
}

/** The part of the day for a local hour. Exported so the mapping can be asserted directly. */
export function dayPartFor(localHour: number): DayPart {
  if (!Number.isFinite(localHour)) return 'morning'
  const hour = ((Math.floor(localHour) % 24) + 24) % 24
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

/**
 * A whole-day index, so the same message is chosen for the whole of one local day and the choice moves on
 * the next day instead of on every render.
 */
export function dayIndex(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000)
}

export function buildWelcomeMessage(options: {
  /** The signed-in user's display name, as the profile reports it. */
  displayName?: string | null
  /** Local time, so the greeting matches the reader's day. */
  now?: Date
}): WelcomeMessage {
  const now = options.now ?? new Date()
  const dayPart = dayPartFor(now.getHours())
  const messages = MESSAGES[dayPart]
  const message = messages[Math.abs(dayIndex(now)) % messages.length]
  const name = options.displayName?.trim() ? options.displayName.trim() : WELCOME_NAME_FALLBACK

  return {
    greeting: `${GREETINGS[dayPart]}, ${name}.`,
    text: message,
    dayPart,
  }
}
