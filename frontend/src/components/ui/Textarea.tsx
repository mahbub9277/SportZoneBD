import * as React from 'react'

import { cn } from '../../lib/utils'

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-22 w-full rounded-2xl border border-(--border) bg-(--surface-soft)/90 px-4 py-3 text-sm font-medium text-(--text-primary) shadow-[0_8px_20px_rgba(2,6,23,0.08)] backdrop-blur-sm ring-offset-(--surface) placeholder:text-(--text-muted) transition-all duration-200 ease-out focus-visible:outline-none focus-visible:border-(--accent)/70 focus-visible:ring-2 focus-visible:ring-(--accent)/30 focus-visible:ring-offset-(--surface) disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    )
  },
)
Textarea.displayName = 'Textarea'

export { Textarea }