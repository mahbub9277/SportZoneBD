import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Card } from '../ui/Card'

interface PageHeroProps {
  title: string
  description: string
  eyebrow?: string
  icon: LucideIcon
  children?: ReactNode
  className?: string
}

export function PageHero({ title, description, eyebrow, icon: Icon, children, className }: PageHeroProps) {
  return (
    <Card
      className={cn(
        'app-page-card relative overflow-hidden border border-(--border) bg-linear-to-r from-yellow-50/30 via-transparent to-slate-900/6 p-0 shadow-[0_28px_80px_rgba(0,0,0,0.18)]',
        className,
      )}
    >
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_left,rgba(255,210,79,0.12),transparent_36%)]" />
      <div className="relative flex flex-col gap-5 p-5 sm:p-6 md:flex-row md:items-end md:justify-between md:p-8">
        <div className="max-w-2xl">
          {eyebrow ? (
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-(--accent)/30 bg-(--surface-soft)/90 px-3 py-1 text-xs font-semibold text-(--text-primary) sm:text-sm">
              <Icon className="h-4 w-4 text-(--accent)" />
              <span>{eyebrow}</span>
            </div>
          ) : null}
          <h1 className="text-2xl font-extrabold tracking-tight text-(--text-primary) sm:text-3xl md:text-4xl">{title}</h1>
          <p className="mt-3 text-sm leading-6 text-(--text-muted) sm:text-base">{description}</p>
        </div>
        {children ? (
          <div className="w-full shrink-0 rounded-2xl border border-(--border)/70 bg-(--surface-soft)/70 px-4 py-3 sm:w-auto">{children}</div>
        ) : null}
      </div>
    </Card>
  )
}
