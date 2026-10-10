/**
 * One place where a TV remote's keys become the actions TV Mode understands.
 *
 * Remotes do not agree on what they send. A standard remote produces `ArrowUp`/`Enter`/`Escape`, a media
 * remote produces `MediaPlayPause` and the channel keys, and some smart-TV browsers report
 * `key: 'Unidentified'` (or an empty `key`) for a button while still filling in the correct `code`. All of
 * that is resolved here into a small action set, so no component has to carry device-specific conditions
 * and the navigation rules can be tested without a browser.
 *
 * This is deliberately conservative: a key that is not in the table is left to the page, so typing in the
 * search box, tabbing and browser shortcuts keep working exactly as they did.
 */

export type TVRemoteAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  /** Enter / OK / select on the focused control. */
  | 'activate'
  /** The remote's Back button, `Escape`, or the Backspace some remotes send instead. */
  | 'back'
  | 'playPause'
  | 'channelUp'
  | 'channelDown'

export interface TVRemoteInput {
  key: string
  /** Used only when `key` is missing or `Unidentified`, which is what some TV browsers report. */
  code?: string
}

/**
 * The key values that mean each action. `Select`, `Accept`, `GoBack` and the `Media*`/`Channel*` keys are
 * the values smart-TV browsers and media remotes actually send; the arrows and `Enter`/`Escape` are the
 * standard ones.
 */
const KEY_ACTIONS: Record<string, TVRemoteAction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'activate',
  ' ': 'activate',
  Spacebar: 'activate',
  Select: 'activate',
  Accept: 'activate',
  Escape: 'back',
  Backspace: 'back',
  GoBack: 'back',
  BrowserBack: 'back',
  Back: 'back',
  MediaPlayPause: 'playPause',
  MediaPlay: 'playPause',
  MediaPause: 'playPause',
  ChannelUp: 'channelUp',
  PageUp: 'channelUp',
  MediaTrackPrevious: 'channelUp',
  ChannelDown: 'channelDown',
  PageDown: 'channelDown',
  MediaTrackNext: 'channelDown',
}

const DIGIT_KEY = /^[0-9]$/
const NUMERIC_CODE = /^(?:Digit|Numpad)([0-9])$/

/** The values worth looking at: a usable `key` first, then `code`. */
const candidates = (input: TVRemoteInput): string[] =>
  [input.key, input.code ?? ''].filter((value) => Boolean(value) && value !== 'Unidentified')

/** The action a remote key means, or null when the key belongs to the page. */
export function actionFromRemote(input: TVRemoteInput): TVRemoteAction | null {
  for (const value of candidates(input)) {
    const action = KEY_ACTIONS[value]
    if (action) return action
  }
  return null
}

/**
 * The digit a remote or keyboard typed, as the channel-number keypad reads it.
 *
 * A remote that reports `key: 'Unidentified'` still reports `code: 'Digit5'`, which is why the code
 * fallback exists.
 */
export function digitFromRemote(input: TVRemoteInput): string | null {
  for (const value of candidates(input)) {
    if (DIGIT_KEY.test(value)) return value
    const numericCode = value.match(NUMERIC_CODE)
    if (numericCode) return numericCode[1]
  }
  return null
}
