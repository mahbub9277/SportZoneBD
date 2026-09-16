type BadgeProps = {
  children: React.ReactNode
  tone?: 'gold' | 'green' | 'red'
}

export function Badge({ children, tone = 'gold' }: BadgeProps) {
  const tones = {
    gold: 'bg-(--accent-soft) text-(--accent)',
    green: 'bg-(--success-soft) text-(--success)',
    red: 'bg-(--danger-soft) text-(--danger)',
  }

  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>{children}</span>
}
