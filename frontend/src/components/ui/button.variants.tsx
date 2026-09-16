import { cva } from 'class-variance-authority'

export const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-semibold ring-offset-(--surface) transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)/60 focus-visible:ring-offset-(--surface) disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] motion-safe:transform-gpu',
  {
    variants: {
      variant: {
        default: 'bg-(--accent) text-slate-950 shadow-[0_18px_60px_rgba(247,199,93,0.22)] hover:bg-(--accent-strong) hover:-translate-y-px',
        destructive: 'bg-rose-600 text-white shadow-[0_18px_60px_rgba(251,113,133,0.22)] hover:bg-rose-500 hover:-translate-y-px',
        outline: 'border border-(--border) bg-(--surface-soft)/55 text-(--text-primary) backdrop-blur-md hover:bg-(--surface)/80 hover:border-(--accent)/40 hover:-translate-y-px',
        secondary: 'bg-(--surface-soft) text-(--text-primary) hover:bg-(--surface) hover:-translate-y-px',
        ghost: 'text-(--text-primary) hover:bg-(--surface-soft) hover:text-(--accent) transition-colors',
        link: 'text-(--accent) underline-offset-4 hover:underline',
        neon: 'bg-(--accent) text-slate-950 shadow-[0_22px_90px_rgba(247,199,93,0.28)] hover:bg-(--accent-strong) font-bold hover:-translate-y-1',
      },
      size: {
        default: 'h-11 px-5 py-2.5',
        sm: 'h-9 px-3',
        lg: 'h-14 px-10 text-lg',
        icon: 'h-10 w-10 px-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)