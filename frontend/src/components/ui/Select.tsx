import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'

import { cn } from '../../lib/utils'

interface SelectOpenControl {
  isOpen: boolean
  /** Clears a stale toggle suppression left behind by an earlier press. */
  resetToggleSuppression: () => void
  /** Closes the list because the trigger itself was pressed again. */
  closeFromTrigger: () => void
}

const SelectOpenContext = React.createContext<SelectOpenControl | null>(null)

/**
 * Radix opens the list on pointerdown and, for non-mouse pointers, opens it again from the click that
 * follows the same press — closing on a trigger press depends on its outside-pointerdown detection,
 * which is unreliable once the trigger sits inside another interactive layer (for example a Dialog).
 * The open state is therefore mirrored here so a press on the trigger toggles it deterministically:
 * pressing the open trigger closes the list and the trailing open of that same press is ignored.
 */
function Select({ open, defaultOpen = false, onOpenChange, children, ...props }: SelectPrimitive.SelectProps) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen)
  const isControlled = open !== undefined
  const isOpen = isControlled ? open : internalOpen
  const suppressNextOpenRef = React.useRef(false)

  const commitOpen = React.useCallback((next: boolean) => {
    if (!isControlled) setInternalOpen(next)
    onOpenChange?.(next)
  }, [isControlled, onOpenChange])

  const handleOpenChange = React.useCallback((next: boolean) => {
    if (next && suppressNextOpenRef.current) {
      suppressNextOpenRef.current = false
      return
    }
    commitOpen(next)
  }, [commitOpen])

  const openControl = React.useMemo<SelectOpenControl>(() => ({
    isOpen,
    resetToggleSuppression: () => { suppressNextOpenRef.current = false },
    closeFromTrigger: () => {
      suppressNextOpenRef.current = true
      commitOpen(false)
    },
  }), [commitOpen, isOpen])

  return (
    <SelectPrimitive.Root {...props} open={isOpen} onOpenChange={handleOpenChange}>
      <SelectOpenContext.Provider value={openControl}>{children}</SelectOpenContext.Provider>
    </SelectPrimitive.Root>
  )
}

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const SelectPortal = SelectPrimitive.Portal

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, onPointerDown, ...props }, ref) => {
  const openControl = React.useContext(SelectOpenContext)

  return (
    <SelectPrimitive.Trigger
      ref={ref}
      onPointerDown={(event) => {
        onPointerDown?.(event)
        if (!openControl) return
        openControl.resetToggleSuppression()
        if (openControl.isOpen) openControl.closeFromTrigger()
      }}
      className={cn(
        'flex h-11 w-full items-center justify-between rounded-2xl border border-(--border)/70 bg-(--surface-soft)/90 px-4 py-2 text-sm font-medium text-(--text-primary) shadow-[0_8px_20px_rgba(15,23,42,0.04)] backdrop-blur-sm transition-all duration-200 ease-out placeholder:text-(--text-muted) focus:outline-none focus:ring-2 focus:ring-(--accent)/40 focus:ring-offset-2 hover:border-(--accent) hover:bg-(--surface) focus:bg-(--surface)',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
})
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        'relative z-50 min-w-40 overflow-hidden rounded-2xl border border-(--border)/70 bg-(--surface)/95 text-(--text-primary) shadow-[0_24px_60px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl animate-in fade-in-80',
        // Scrolling behavior for long lists: the viewport stays content sized, the list grows only up
        // to the space Radix measured, then scrolls.
        'overflow-y-auto max-h-(--radix-select-content-available-height)',
        position === 'popper' && 'translate-y-1',
        className,
      )}
      position={position}
      {...props}
    >
      <SelectPrimitive.Viewport
        className={cn('p-1 w-full', position === 'popper' && 'min-w-(--radix-select-trigger-width)')}
      >
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-default select-none items-center rounded-2xl px-4 py-2 text-sm outline-none transition-colors duration-200 hover:bg-(--surface-soft) focus:bg-(--surface-soft) focus:text-(--text-primary) data-[state=checked]:bg-(--accent) data-[state=checked]:text-black data-disabled:pointer-events-none data-disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>

    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectItem, SelectPortal }