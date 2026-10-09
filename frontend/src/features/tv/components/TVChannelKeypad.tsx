import { Delete, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { TVChannel } from '../tvChannels'

interface TVChannelKeypadProps {
  /** Resolves the typed digits against the real channel catalogue; null when no channel holds them. */
  resolveChannelNumber: (digits: string) => TVChannel | null
  /** Tunes through the same selection path the channel cards use, so access rules are unchanged. */
  onTune: (channel: TVChannel) => void
  onClose: () => void
}

/** A four-digit entry covers every realistic catalogue without letting the display grow unbounded. */
const MAX_DIGITS = 4

/**
 * The key order of the grid, and therefore its arrow-navigation order: `1-9`, clear, `0`, OK — the
 * twelve keys a viewer expects, laid out three to a row.
 */
const KEY_ORDER = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'ok'] as const

const COLUMNS = 3

/**
 * The numeric channel keypad.
 *
 * It is a UI surface only: it resolves what the viewer typed against the catalogue the page already
 * has, and hands the result to the existing channel-selection function. No request, no player call and
 * no stream knowledge lives here, which is why opening it can never disturb playback.
 *
 * Every key it handles stops propagating, so the shell's arrow and channel keys cannot fire behind the
 * open keypad and change the channel the viewer is typing into.
 */
export function TVChannelKeypad({ resolveChannelNumber, onTune, onClose }: TVChannelKeypadProps) {
  const [digits, setDigits] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const keyRefs = useRef<Array<HTMLButtonElement | null>>([])

  const focusKey = useCallback((index: number) => {
    keyRefs.current[index]?.focus({ preventScroll: true })
  }, [])

  // The keypad takes focus as it opens, on its first key: a remote can type a number straight away, and
  // the page suspends its own focus restore while this is open.
  useEffect(() => {
    focusKey(0)
  }, [focusKey])

  const appendDigit = useCallback((digit: string) => {
    setMessage(null)
    setDigits((current) => (current.length >= MAX_DIGITS ? current : current + digit))
  }, [])

  const backspace = useCallback(() => {
    setMessage(null)
    setDigits((current) => current.slice(0, -1))
  }, [])

  const clear = useCallback(() => {
    setMessage(null)
    setDigits('')
  }, [])

  const tune = useCallback(() => {
    if (!digits) {
      setMessage('Enter a channel number')
      return
    }

    const channel = resolveChannelNumber(digits)
    if (!channel) {
      setMessage(`Channel not found — no number ${Number(digits)}.`)
      return
    }

    onTune(channel)
  }, [digits, onTune, resolveChannelNumber])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const active = document.activeElement
    // -1 means focus is on the close button, which is outside the grid: any arrow returns to it.
    const index = keyRefs.current.findIndex((key) => key === active)
    const column = index % COLUMNS
    const row = Math.floor(index / COLUMNS)

    switch (event.key) {
      case 'Enter':
        // OK/Enter tunes. Without this the browser's own button activation wins and "presses" whichever
        // key has focus — so Enter on a digit appended it instead of submitting the number.
        event.preventDefault()
        tune()
        break
      case 'Escape':
        event.preventDefault()
        onClose()
        break
      case 'Backspace':
        event.preventDefault()
        backspace()
        break
      case 'ArrowLeft':
        event.preventDefault()
        if (index === -1) focusKey(0)
        else if (index > 0 && column > 0) focusKey(index - 1)
        break
      case 'ArrowRight':
        event.preventDefault()
        if (index === -1) focusKey(0)
        else if (index >= 0 && column < COLUMNS - 1) focusKey(index + 1)
        break
      case 'ArrowUp':
        event.preventDefault()
        if (index === -1) focusKey(0)
        else if (index >= 0 && row > 0) focusKey(index - COLUMNS)
        break
      case 'ArrowDown':
        event.preventDefault()
        if (index === -1) focusKey(0)
        else if (index >= 0 && row < KEY_ORDER.length / COLUMNS - 1) focusKey(index + COLUMNS)
        break
      default:
        if (/^[0-9]$/.test(event.key)) {
          event.preventDefault()
          appendDigit(event.key)
        }
        break
    }

    // Nothing typed into the keypad may reach the shell, so no key can also zap a channel or toggle the
    // player while the viewer is entering a number.
    event.stopPropagation()
  }, [appendDigit, backspace, focusKey, onClose, tune])

  return (
    <div
      data-tv-zone="keypad"
      className="tv-keypad"
      role="group"
      aria-label="Channel number keypad"
      onKeyDown={handleKeyDown}
    >
      <div className="tv-keypad-header">
        <span className="tv-keypad-title">Channel</span>
        <button
          type="button"
          className="tv-keypad-close"
          onClick={onClose}
          aria-label="Close channel number keypad"
          title="Close keypad"
        >
          <X aria-hidden="true" />
        </button>
      </div>

      <output className="tv-keypad-display" aria-live="polite" aria-label="Channel number entered">
        {digits || '—'}
      </output>

      <div className="tv-keypad-grid">
        {KEY_ORDER.map((key, index) => {
          const setRef = (element: HTMLButtonElement | null) => { keyRefs.current[index] = element }

          if (key === 'clear') {
            return (
              <button key={key} ref={setRef} type="button" className="tv-keypad-key tv-keypad-key-utility" onClick={clear} aria-label="Clear the number" title="Clear">
                <Delete aria-hidden="true" />
              </button>
            )
          }

          if (key === 'ok') {
            return (
              <button key={key} ref={setRef} type="button" className="tv-keypad-key tv-keypad-key-tune" onClick={tune} aria-label="Tune to the entered channel" title="Tune">
                OK
              </button>
            )
          }

          return (
            <button key={key} ref={setRef} type="button" className="tv-keypad-key" onClick={() => appendDigit(key)} aria-label={`Channel number ${key}`}>
              {key}
            </button>
          )
        })}
      </div>

      <p className="tv-keypad-message" role="status">
        {message ?? 'Type a channel number, then OK'}
      </p>
    </div>
  )
}
