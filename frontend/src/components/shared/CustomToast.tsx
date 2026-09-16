import { CheckCircle, XCircle } from 'lucide-react'

interface CustomToastProps {
  type: 'success' | 'error'
  title: string
  description: string
}

export const CustomToast = ({ type, title, description }: CustomToastProps) => {
  const Icon = type === 'success' ? CheckCircle : XCircle
  const iconColor = type === 'success' ? 'text-emerald-400' : 'text-rose-400'
  const panelTone = type === 'success' ? 'border-emerald-500/30 bg-emerald-500/8' : 'border-rose-500/30 bg-rose-500/8'

  return (
    <div className={`flex w-full max-w-sm items-start gap-4 rounded-2xl border p-4 text-(--text-primary) shadow-[0_24px_80px_rgba(2,6,23,0.28)] backdrop-blur-xl ${panelTone}`}>
      <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-(--surface-soft) ring-1 ring-white/10">
        <Icon className={`h-5 w-5 shrink-0 ${iconColor}`} />
      </div>
      <div className="flex-1">
        <p className="font-semibold text-(--text-primary)">{title}</p>
        <p className="mt-1 text-sm text-(--text-muted)">{description}</p>
      </div>
    </div>
  )
}