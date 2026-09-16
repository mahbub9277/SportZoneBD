import * as React from 'react'

import { cn } from '../../lib/utils'

type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, value, onChange, readOnly, disabled, ...props }, ref) => {
    const normalizedValue =
      value === null || value === undefined
        ? type === 'file'
          ? undefined
          : ''
        : value

    const shouldReadOnly =
      readOnly ||
      disabled ||
      (normalizedValue !== undefined && onChange === undefined && type !== 'file')

    return (
      <input
        type={type}
        value={normalizedValue}
        onChange={onChange}
        readOnly={shouldReadOnly}
        disabled={disabled}
        className={cn(
          'flex h-auto w-full rounded-2xl border border-(--border) bg-(--surface-soft)/90 px-4 py-3 pr-12 text-sm font-medium text-(--text-primary) shadow-[0_8px_20px_rgba(2,6,23,0.08)] backdrop-blur-sm placeholder:text-(--text-muted) ring-offset-(--surface) transition-all duration-200 ease-out focus-visible:outline-none focus-visible:border-(--accent)/70 focus-visible:ring-2 focus-visible:ring-(--accent)/30 focus-visible:ring-offset-(--surface) disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'

export { Input }