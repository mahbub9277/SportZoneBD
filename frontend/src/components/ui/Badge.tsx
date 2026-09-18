import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

export const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold transition duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-(--accent)/40 focus:ring-offset-[var(--surface)]',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-(--accent) text-slate-950 shadow-[0_10px_30px_rgba(247,199,93,0.18)]',
        secondary: 'border-transparent bg-(--accent-secondary)/15 text-(--accent-secondary)',
        destructive: 'border-transparent bg-(--danger-soft) text-(--danger)',
        success: 'border-transparent bg-(--success-soft) text-(--success)',
        outline: 'border border-(--border) bg-(--surface-soft)/90 text-(--text-primary)',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}
