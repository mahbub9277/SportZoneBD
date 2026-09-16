import { Button } from '../../components/ui/Button'
import { Card, CardContent } from '../../components/ui/Card'
import { ShieldCheck, Users, Crown, Radio } from 'lucide-react'

const stats = [
  { label: 'Total users', value: '12.4k', icon: Users },
  { label: 'Premium subscribers', value: '3.8k', icon: Crown },
  { label: 'Live streams', value: '24', icon: Radio },
]

export function AdminPage() {
  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-(--accent)/30 bg-(--surface-strong) px-3 py-1 text-sm text-(--text-primary)">
              <ShieldCheck size={16} className="text-(--accent)" />
              Enterprise control center
            </div>
            <h1 className="mt-3 text-3xl font-semibold text-(--text-primary)">Admin dashboard</h1>
            <p className="mt-2 max-w-2xl text-(--text-muted)">
              Monitor the platform, manage access, and keep premium content operations running smoothly.
            </p>
          </div>
          <Button variant="secondary">+ Create broadcast</Button>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {stats.map((item) => {
          const Icon = item.icon
          return (
            <Card key={item.label}>
              <CardContent className="flex items-center gap-3 p-5">
                <div className="rounded-2xl bg-(--surface-soft) p-3 text-(--accent)">
                  <Icon size={20} />
                </div>
                <div>
                  <p className="text-2xl font-semibold text-(--text-primary)">{item.value}</p>
                  <p className="text-sm text-(--text-muted)">{item.label}</p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <h2 className="text-xl font-semibold text-(--text-primary)">Recent operations</h2>
        <div className="mt-4 space-y-3">
          {['RBAC roles synced', 'Premium access policy updated', 'Match moderation queue refreshed'].map((item) => (
            <div key={item} className="flex items-center justify-between rounded-2xl border border-(--border) bg-(--surface) px-4 py-3 text-sm text-(--text-muted)">
              <span>{item}</span>
              <span className="text-(--accent)">Live</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
