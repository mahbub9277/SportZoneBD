import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Home, RefreshCw, type LucideIcon } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { Button } from '../../components/ui/Button'

interface ErrorStatusPageProps {
  code: string
  eyebrow: string
  title: string
  description: string
  icon: LucideIcon
  tone?: 'accent' | 'danger' | 'warning'
  showRetry?: boolean
}

const toneClasses = {
  accent: 'border-accent/25 bg-accent/10 text-accent',
  danger: 'border-danger/25 bg-danger-soft text-danger',
  warning: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
}

export function ErrorStatusPage({ code, eyebrow, title, description, icon: Icon, tone = 'accent', showRetry = false }: ErrorStatusPageProps) {
  const navigate = useNavigate()
  const shouldReduceMotion = useReducedMotion()
  const toneClass = toneClasses[tone]

  return (
    <main className="relative flex min-h-[calc(100vh-5rem)] items-center justify-center overflow-hidden px-4 py-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(4,116,196,0.14),transparent_48%)]" />
      <motion.div
        initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 20, scale: shouldReduceMotion ? 1 : 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.45, ease: 'easeOut' }}
        className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-border bg-surface/95 p-8 text-center shadow-[0_30px_100px_rgba(2,6,23,0.2)] backdrop-blur-xl sm:p-12"
      >
        <motion.div
          aria-hidden="true"
          animate={shouldReduceMotion ? undefined : { rotate: 360 }}
          transition={shouldReduceMotion ? undefined : { duration: 24, repeat: Infinity, ease: 'linear' }}
          className="absolute -right-24 -top-24 h-56 w-56 rounded-full border border-accent/10"
        />
        <div className={`relative mx-auto grid h-20 w-20 place-items-center rounded-3xl border ${toneClass}`}>
          <Icon className="h-9 w-9" strokeWidth={1.7} />
        </div>
        <p className="mt-7 text-xs font-semibold uppercase tracking-[0.3em] text-text-muted">{eyebrow}</p>
        <p className="mt-3 text-6xl font-semibold tracking-tight text-text-primary sm:text-7xl">{code}</p>
        <h1 className="mt-4 text-2xl font-semibold text-text-primary sm:text-3xl">{title}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-text-muted">{description}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/">
            <Button className="gap-2"><Home className="h-4 w-4" />Home</Button>
          </Link>
          <Button type="button" variant="secondary" onClick={() => navigate(-1)} className="gap-2"><ArrowLeft className="h-4 w-4" />Go back</Button>
          {showRetry && <Button type="button" variant="outline" onClick={() => window.location.reload()} className="gap-2"><RefreshCw className="h-4 w-4" />Retry</Button>}
        </div>
      </motion.div>
    </main>
  )
}
