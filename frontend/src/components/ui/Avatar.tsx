import * as React from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { AnimatePresence, motion } from 'framer-motion'
import { Spinner } from './Spinner'

import { cn } from '../../lib/utils'

const getInitials = (name: string) => {
  const names = name.trim().split(' ')
  if (names.length === 1 && names[0]) return names[0].charAt(0).toUpperCase()
  if (names.length > 1) {
    const first = names[0]
    const last = names[names.length - 1]
    return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
  }
  return '?'
}

const generateColor = (name: string) => {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const h = ((hash % 360) + 360) % 360
  return `hsl(${h}, 60%, 70%)`
}

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & { isLoading?: boolean }
>(({ className, isLoading = false, children, ...props }, ref) => {
  return (
    <AvatarPrimitive.Root
      ref={ref}
      className={cn('relative flex size-10 shrink-0 overflow-hidden rounded-full border border-(--border) bg-(--surface-soft)', className)}
      {...props}
    >
      {children}
      <AnimatePresence>
        {isLoading && (
          <motion.div
            className="absolute inset-0 z-10 flex items-center justify-center bg-(--surface)/75 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Spinner size="50%" />
          </motion.div>
        )}
      </AnimatePresence>
    </AvatarPrimitive.Root>
  )
})
Avatar.displayName = AvatarPrimitive.Root.displayName

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn('aspect-square h-full w-full object-cover', className)}
    draggable={false}
    {...props}
  />
))
AvatarImage.displayName = AvatarPrimitive.Image.displayName

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback> & { name?: string }
>(({ className, name = '', children, ...props }, ref) => {
  const initials = getInitials(name)
  const color = generateColor(name)

  return (
    <AvatarPrimitive.Fallback
      ref={ref}
      className={cn('flex h-full w-full items-center justify-center rounded-full font-semibold text-white', className)}
      style={{ backgroundColor: color }}
      {...props}
    >
      {children || initials}
    </AvatarPrimitive.Fallback>
  )
})
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName

export { Avatar, AvatarImage, AvatarFallback }