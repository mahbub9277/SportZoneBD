import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Skeleton } from '@/components/ui/Skeleton'
import { useGetAdminSettingsQuery, useUpsertAdminSettingMutation } from '@/features/admin/admin.api'
import type { SiteSetting } from '@/features/admin/admin.api'
import { RefreshCw, Server, CheckCircle2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface HealthResponse {
  status: string
  service: string
}

const defaultApiFields = {
  'api.base_url': import.meta.env.VITE_API_URL ?? '/api/v1',
  'api.timeout_seconds': '30',
}
const emptySettings: SiteSetting[] = []

export default function ApiSettingsPage() {
  const settingsQuery = useGetAdminSettingsQuery()
  const settings = settingsQuery.data ?? emptySettings
  const { isLoading: isLoadingSettings } = settingsQuery
  const [upsertSetting, { isLoading: isSaving }] = useUpsertAdminSettingMutation()
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [isLoadingHealth, setIsLoadingHealth] = useState(false)
  const [healthError, setHealthError] = useState(false)
  const [form, setForm] = useState<Record<keyof typeof defaultApiFields, string>>(defaultApiFields)

  const settingsMap = useMemo(() => new Map(settings.map((setting) => [setting.key, setting])), [settings])
  const getFieldValue = (key: keyof typeof defaultApiFields) => form[key] ?? settingsMap.get(key)?.value ?? defaultApiFields[key]

  const loadHealth = async () => {
    setIsLoadingHealth(true)
    setHealthError(false)

    try {
      const configuredApiUrl = String(import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/+$/, '')
      const healthUrl = `${configuredApiUrl}/health`
      const response = await fetch(healthUrl, { credentials: 'include', headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`Health request failed with ${response.status}`)
      const result = (await response.json()) as Partial<HealthResponse>
      if (typeof result.status !== 'string' || typeof result.service !== 'string') throw new Error('Invalid health response')
      setHealth(result as HealthResponse)
    } catch {
      setHealth(null)
      setHealthError(true)
    } finally {
      setIsLoadingHealth(false)
    }
  }

  const handleSave = async (key: keyof typeof defaultApiFields) => {
    try {
      const nextValue = getFieldValue(key)
      const updatedSettings = await upsertSetting({
        key,
        value: nextValue,
        type: 'string',
        description: 'API configuration setting',
      }).unwrap()

      const updated = updatedSettings.find((setting) => setting.key === key)
      toast.success(updated ? `${key} saved at ${new Date(updated.updatedAt ?? Date.now()).toLocaleTimeString()}.` : `${key} saved successfully.`)
    } catch {
      toast.error('Unable to save API setting right now.')
    }
  }

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <div className="flex items-center gap-3">
          <motion.div className="p-2 bg-linear-to-br from-green-500 to-green-600 rounded-lg" whileHover={{ scale: 1.1 }}>
          <Server className="h-5 w-5 text-white" />
          </motion.div>
          <div>
        <h1 className="text-3xl font-semibold">API Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Configure runtime API values and inspect the current health of the backend service.</p>
          </div>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
      <Card className="border border-(--border) bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/70 to-(--surface) shadow-[0_20px_60px_var(--shadow)]">
        <CardHeader>
          <CardTitle>API configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingSettings ? <Skeleton className="h-24 w-full" /> : (
            Object.entries(defaultApiFields).map(([key], index) => {
              const setting = settingsMap.get(key)
              return (
              <motion.div key={key} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + index * 0.05 }} className="rounded-lg border border-(--border) bg-linear-to-br from-(--surface-soft)/50 to-(--surface)/50 p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <Label htmlFor={key} className="text-sm font-semibold">{key}</Label>
                    <p className="mt-1 text-xs text-muted-foreground">{setting?.description ?? 'API configuration setting'}</p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => handleSave(key as keyof typeof defaultApiFields)} disabled={isSaving}>
                    Save
                  </Button>
                </div>
                <Input
                  id={key}
                  value={getFieldValue(key as keyof typeof defaultApiFields)}
                  onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  {setting ? `Persisted ${new Date(setting.updatedAt ?? setting.createdAt ?? new Date().toISOString()).toLocaleString()}` : 'Using the system default'}
                </p>
              </motion.div>
              )
            })
          )}

          {isLoadingHealth ? <Skeleton className="h-16 w-full" /> : (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="flex items-center justify-between gap-4 rounded-lg border border-(--border) bg-linear-to-br from-(--surface-soft)/50 to-(--surface)/50 p-4">
              <div className="flex min-w-0 items-center gap-3">
                {healthError ? <AlertCircle className="h-5 w-5 shrink-0 text-red-400" /> : <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />}
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground">Backend health</p>
                  <p className={cn('truncate font-semibold', healthError ? 'text-red-400' : 'text-emerald-400')}>
                    {health?.service ?? 'Unavailable'} / {health?.status ?? 'Unknown'}
                  </p>
                </div>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => void loadHealth()} disabled={isLoadingHealth} className="shrink-0 gap-2">
                <RefreshCw className={cn('h-4 w-4', isLoadingHealth && 'animate-spin')} />
                Refresh
              </Button>
            </motion.div>
          )}
        </CardContent>
      </Card>
      </motion.div>
    </motion.div>
  )
}