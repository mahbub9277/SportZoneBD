import { useCallback, useEffect, useRef, type RefObject } from 'react'

/**
 * The TV focus system.
 *
 * Focus is native DOM focus: every remote-operable element carries `data-tv-item` inside a
 * `data-tv-zone` container, and this hook only decides where focus goes next. That keeps the cost of
 * moving focus at zero React renders, and it means the focused control is a real focusable element for
 * assistive technology and for the browser's own Enter/Space activation.
 *
 *   zone "toolbar"    Back · Refresh · Search        (horizontal)
 *   zone "categories" the category filter row        (horizontal)
 *   zone "channels"  the channel list                (vertical, scrolls independently)
 *   zone "player"     the player's TV control row    (horizontal)
 *
 * Arrow keys move inside a zone and between zones in the order above; Enter/Space is left to the
 * focused control so buttons behave exactly as they normally do.
 */
export type TVZone = 'toolbar' | 'categories' | 'channels' | 'player'

const ZONES: TVZone[] = ['toolbar', 'categories', 'channels', 'player']

/** Elements that own the arrow keys themselves (text entry, sliders). */
const EDITABLE_TAGS = ['INPUT', 'TEXTAREA', 'SELECT']

function isEditable(element: Element | null): boolean {
  if (!element) return false
  if (EDITABLE_TAGS.includes(element.tagName)) return true
  return (element as HTMLElement).isContentEditable
}

export interface UseTVFocusOptions {
  /** Called for Back/Escape/Backspace when the remote's Back key has to be handled in-app. */
  onBack: () => void
  /** Channel up / channel down, triggered by the keys remotes send for CH+ and CH−. */
  onChannelStep: (direction: 1 | -1) => void
  /** Play/pause for the media keys some remotes expose. */
  onTogglePlayback: () => void
  /**
   * A digit pressed on a remote anywhere in the shell. Channel entry belongs to the keypad, so the
   * shell forwards the digit instead of owning a second buffer.
   */
  onDigitKey?: (digit: string) => void
  /** Preferred focus target, for example the channel that is playing. */
  preferredKey?: string | null
  /** Changes whenever the visible list changes (category, search, refresh), so focus can be restored. */
  listVersion?: string
  /**
   * True while an overlay (the channel keypad) owns focus. Automatic focus restoration is suspended so
   * a channel change behind the overlay cannot pull focus out of what the viewer is typing into.
   */
  suspendAutoFocus?: boolean
}

export interface TVFocusApi {
  handleKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
  focusZone: (zone: TVZone, preferredKey?: string | null) => void
}

function itemsOf(root: HTMLElement, zone: TVZone): HTMLElement[] {
  const containers = root.querySelectorAll<HTMLElement>(`[data-tv-zone="${zone}"]`)
  const items: HTMLElement[] = []

  for (const container of containers) {
    // A zone container can be a focus stop itself (the player surface in full screen), so it is
    // considered alongside its descendants.
    for (const item of [container, ...container.querySelectorAll<HTMLElement>('[data-tv-item]')]) {
      if (!item.hasAttribute('data-tv-item')) continue
      // Hidden zones (the collapsed player controls) and disabled controls are not focus stops.
      if (item.hasAttribute('disabled') || item.getAttribute('aria-hidden') === 'true') continue
      if (item.offsetParent === null) continue
      items.push(item)
    }
  }

  return items
}

function currentZoneItem(root: HTMLElement): { zone: TVZone | null; element: HTMLElement | null } {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !root.contains(active)) return { zone: null, element: null }
  const zone = ZONES.find((candidate) => active.closest(`[data-tv-zone="${candidate}"]`))
  return { zone: zone ?? null, element: active }
}

export function useTVFocus(rootRef: RefObject<HTMLElement | null>, options: UseTVFocusOptions): TVFocusApi {
  const { onBack, onChannelStep, onTogglePlayback, onDigitKey, preferredKey, listVersion = '', suspendAutoFocus = false } = options
  const lastKeyRef = useRef<string | null>(null)

  const focusItem = useCallback((item: HTMLElement | null) => {
    if (!item) return false
    item.focus({ preventScroll: true })
    // Instant scrolling: smooth scrolling over a long channel list is exactly the kind of continuous
    // animation a weak TV GPU drops frames on.
    item.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    lastKeyRef.current = item.getAttribute('data-tv-key')
    return true
  }, [])

  const focusZone = useCallback((zone: TVZone, preferred?: string | null) => {
    const root = rootRef.current
    if (!root) return

    const items = itemsOf(root, zone)
    if (items.length === 0) return

    const wanted = preferred ?? lastKeyRef.current
    const remembered = wanted ? items.find((item) => item.getAttribute('data-tv-key') === wanted) : undefined
    const selected = items.find((item) => item.getAttribute('data-tv-selected') === 'true')

    focusItem(remembered ?? selected ?? items[0])
  }, [focusItem, rootRef])

  const moveWithin = useCallback((zone: TVZone, direction: 1 | -1) => {
    const root = rootRef.current
    if (!root) return

    const items = itemsOf(root, zone)
    if (items.length === 0) return

    const active = document.activeElement
    const index = active instanceof HTMLElement ? items.indexOf(active) : -1
    const nextIndex = index === -1 ? 0 : Math.min(items.length - 1, Math.max(0, index + direction))
    focusItem(items[nextIndex])
  }, [focusItem, rootRef])

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    const root = rootRef.current
    if (!root) return

    const { zone } = currentZoneItem(root)
    const target = event.target as HTMLElement | null

    // Media and channel keys work from anywhere in the shell: they are what a TV remote sends for
    // play/pause and for channel up/down.
    switch (event.key) {
      case 'MediaPlayPause':
        event.preventDefault()
        onTogglePlayback()
        return
      case 'MediaTrackNext':
      case 'PageDown':
      case 'ChannelDown':
        event.preventDefault()
        onChannelStep(1)
        return
      case 'MediaTrackPrevious':
      case 'PageUp':
      case 'ChannelUp':
        event.preventDefault()
        onChannelStep(-1)
        return
      case 'Escape':
        event.preventDefault()
        if (isEditable(target)) {
          target?.blur()
          focusZone('toolbar')
          return
        }
        onBack()
        return
      case 'Backspace':
        // A remote Back key often arrives as Backspace; inside text entry it must stay a delete.
        if (isEditable(target)) return
        event.preventDefault()
        onBack()
        return
      default:
        break
    }

    // Typing in the search box keeps its own arrow behaviour, with the vertical moves that make sense.
    if (isEditable(target)) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        focusZone('categories')
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        focusZone('toolbar')
      }
      return
    }

    // A digit anywhere in the shell starts (or continues) channel-number entry. It is handled here, once,
    // so no key can also zap a channel or scroll the page, and the keypad stays the only owner of the
    // typed number.
    if (onDigitKey && /^[0-9]$/.test(event.key)) {
      event.preventDefault()
      onDigitKey(event.key)
      return
    }

    // The player surface itself is a focus stop: OK/Enter on it is play/pause, and the arrows zap
    // channels, which is what a viewer expects with nothing but the video on screen.
    const onPlayerSurface = zone === 'player' && document.activeElement?.getAttribute('data-tv-key') === 'stage'
    if (onPlayerSurface && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      onTogglePlayback()
      return
    }

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault()
        if (zone === 'toolbar') focusZone('categories')
        else if (zone === 'categories') focusZone('channels')
        else if (zone === 'player') onChannelStep(1)
        else moveWithin('channels', 1)
        return
      }
      case 'ArrowUp': {
        event.preventDefault()
        if (zone === 'channels') {
          const items = itemsOf(root, 'channels')
          const active = document.activeElement
          if (items[0] === active) focusZone('categories')
          else moveWithin('channels', -1)
        } else if (zone === 'categories') focusZone('toolbar')
        else if (zone === 'player') onChannelStep(-1)
        return
      }
      case 'ArrowRight': {
        event.preventDefault()
        if (zone === 'channels') focusZone('player')
        else moveWithin(zone ?? 'toolbar', 1)
        return
      }
      case 'ArrowLeft': {
        event.preventDefault()
        if (zone === 'player') focusZone('channels')
        else if (zone === 'channels') focusZone('categories')
        else moveWithin(zone ?? 'toolbar', -1)
        return
      }
      default:
        break
    }
  }, [focusZone, moveWithin, onBack, onChannelStep, onDigitKey, onTogglePlayback, rootRef])

  const focusZoneRef = useRef(focusZone)
  useEffect(() => {
    focusZoneRef.current = focusZone
  }, [focusZone])

  // Focus must never disappear: when the list re-renders (refresh, category change, a search that
  // removes the focused channel) the focused element is gone, so focus is restored to the remembered
  // key, then to the selected channel, then to the first stop of that zone.
  useEffect(() => {
    if (suspendAutoFocus) return
    const root = rootRef.current
    if (!root) return

    const active = document.activeElement
    const stillValid = active instanceof HTMLElement && root.contains(active) && active.hasAttribute('data-tv-item')
    if (stillValid) return

    const { zone } = currentZoneItem(root)
    focusZoneRef.current(zone === 'player' ? 'player' : 'channels', preferredKey ?? lastKeyRef.current)
  }, [listVersion, preferredKey, rootRef, suspendAutoFocus])

  // Entering TV Mode puts focus on the channel that is playing, so the first arrow key already works.
  useEffect(() => {
    if (suspendAutoFocus) return
    const root = rootRef.current
    if (!root) return
    focusZoneRef.current('channels', preferredKey ?? null)
  }, [preferredKey, rootRef, suspendAutoFocus])

  return { handleKeyDown, focusZone }
}
