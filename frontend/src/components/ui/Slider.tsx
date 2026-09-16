'use client'

import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'

import { cn } from '../../lib/utils'

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      'relative flex min-h-6 w-full touch-none select-none items-center touch-action-none px-1',
      className,
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-(--surface-soft)">
      <SliderPrimitive.Range className="absolute h-full bg-linear-to-r from-(--accent)/80 to-(--accent-secondary)" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-5 w-5 shrink-0 cursor-pointer rounded-full border-2 border-white bg-(--accent) shadow-[0_10px_28px_rgba(247,199,93,0.28)] ring-offset-(--surface) transition duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)/50 focus-visible:ring-offset-(--surface) disabled:pointer-events-none disabled:opacity-50" />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }