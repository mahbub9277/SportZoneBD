import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { Settings, Save, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Label } from '../../components/ui/Label'
import { useDeleteAdminSettingMutation, useGetAdminSettingsQuery, useUpsertAdminSettingMutation } from '../../features/admin/admin.api'
import { Skeleton } from '../../components/ui/Skeleton'

export function AdminSettingsPage() {
  const { data: settings = [], isLoading } = useGetAdminSettingsQuery()
  const [upsertSetting, { isLoading: isSaving }] = useUpsertAdminSettingMutation()
  const [deleteSetting, { isLoading: isDeleting }] = useDeleteAdminSettingMutation()
  const [form, setForm] = useState({ key: '', value: '', type: 'string', description: '' })

  const settingsMap = useMemo(
    () => Object.fromEntries(settings.map((setting) => [setting.key, setting.value] as const)),
    [settings],
  )

  const currentSplashVariant = settingsMap['site.splash_variant'] === 'premium' ? 'premium' : 'standard'
  const [splashVariant, setSplashVariant] = useState<'standard' | 'premium'>(currentSplashVariant)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!form.key.trim()) {
      toast.error('Please enter a setting key.')
      return
    }

    try {
      await upsertSetting({
        key: form.key.trim(),
        value: form.value,
        type: form.type,
        description: form.description,
      }).unwrap()

      toast.success('Setting saved successfully.')
      setForm({ key: '', value: '', type: 'string', description: '' })
    } catch {
      toast.error('Unable to save the setting right now.')
    }
  }


  const handleSaveSplashVariant = async () => {
    try {
      await upsertSetting({
        key: 'site.splash_variant',
        value: splashVariant,
        type: 'string',
        description: 'Splash screen variant for the onboarding experience.',
      }).unwrap()
      toast.success('Splash screen variant saved successfully.')
    } catch {
      toast.error('Unable to save splash screen variant right now.')
    }
  }

  const handleDelete = async (key: string) => {
    try {
      await deleteSetting(key).unwrap()
      toast.success('Setting removed.')
    } catch {
      toast.error('Unable to delete the setting.')
    }
  }

  return (
    <motion.div className="space-y-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div className="space-y-2 border-b border-(--border) pb-6" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.4 }}>
        <div className="flex items-center gap-3">
          <motion.div className="p-2 bg-linear-to-br from-(--accent) to-(--accent)/80 rounded-lg" whileHover={{ scale: 1.1 }}>
            <Settings className="h-6 w-6 text-white" />
          </motion.div>
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-brand-text-primary">Admin Settings</h1>
            <p className="text-base text-brand-text-muted/80">Configure system behavior, splash screens, and custom settings.</p>
          </div>
        </div>
      </motion.div>

      {/* Splash Screen Configuration */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.4 }}>
        <Card className="overflow-hidden border border-(--border) bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/70 to-(--surface) shadow-[0_20px_60px_var(--shadow)]">
          <CardHeader className="border-b border-(--border) bg-linear-to-r from-(--surface-soft)/30 to-transparent px-6 py-4">
            <motion.div className="flex items-center gap-3" initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2, duration: 0.4 }}>
              <motion.div className="p-2 bg-linear-to-br from-purple-500 to-purple-600 rounded-lg" whileHover={{ scale: 1.1 }}>
                <Settings className="h-5 w-5 text-white" />
              </motion.div>
              <CardTitle className="text-2xl font-bold text-brand-text-primary">Splash Screen Configuration</CardTitle>
            </motion.div>
          </CardHeader>

          <CardContent className="space-y-6 p-6 sm:p-8">
            <div className="grid gap-6 md:grid-cols-2">
              <motion.div className="space-y-4 rounded-xl border border-(--border) bg-linear-to-br from-(--surface-soft)/30 to-transparent p-5" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25, duration: 0.4 }}>
                <Label className="text-sm font-semibold text-brand-text-primary">Select Variant</Label>
                <div className="flex flex-wrap gap-3">
                  <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="flex-1">
                    <Button
                      type="button"
                      variant={splashVariant === 'standard' ? 'default' : 'outline'}
                      onClick={() => setSplashVariant('standard')}
                      className={`w-full rounded-lg py-2 transition-all ${
                        splashVariant === 'standard'
                          ? 'bg-linear-to-r from-(--accent) to-(--accent)/80 shadow-lg'
                          : 'border-2 border-(--accent)/50 hover:border-(--accent)'
                      }`}
                    >
                      Standard
                    </Button>
                  </motion.div>
                  <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="flex-1">
                    <Button
                      type="button"
                      variant={splashVariant === 'premium' ? 'default' : 'outline'}
                      onClick={() => setSplashVariant('premium')}
                      className={`w-full rounded-lg py-2 transition-all ${
                        splashVariant === 'premium'
                          ? 'bg-linear-to-r from-(--accent) to-(--accent)/80 shadow-lg'
                          : 'border-2 border-(--accent)/50 hover:border-(--accent)'
                      }`}
                    >
                      Premium
                    </Button>
                  </motion.div>
                </div>
              </motion.div>

              <motion.div className="flex items-end" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25, duration: 0.4 }}>
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="w-full md:w-auto">
                  <Button
                    type="button"
                    onClick={handleSaveSplashVariant}
                    disabled={isSaving}
                    className="w-full rounded-lg bg-linear-to-r from-(--accent) to-(--accent)/80 px-6 py-2.5 font-semibold shadow-md hover:shadow-lg disabled:opacity-60"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {isSaving ? 'Saving...' : 'Apply Variant'}
                  </Button>
                </motion.div>
              </motion.div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Add Custom Setting */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.4 }}>
        <Card className="overflow-hidden border border-(--border) bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/70 to-(--surface) shadow-[0_20px_60px_var(--shadow)]">
          <CardHeader className="border-b border-(--border) bg-linear-to-r from-(--surface-soft)/30 to-transparent px-6 py-4">
            <motion.div className="flex items-center gap-3" initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25, duration: 0.4 }}>
              <motion.div className="p-2 bg-linear-to-br from-blue-500 to-blue-600 rounded-lg" whileHover={{ scale: 1.1 }}>
                <Settings className="h-5 w-5 text-white" />
              </motion.div>
              <CardTitle className="text-2xl font-bold text-brand-text-primary">Add Custom Setting</CardTitle>
            </motion.div>
          </CardHeader>

          <CardContent className="p-6 sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <motion.div className="space-y-3" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.4 }}>
                  <Label htmlFor="setting-key" className="text-sm font-semibold text-brand-text-primary">Setting Key</Label>
                  <Input
                    id="setting-key"
                    value={form.key}
                    onChange={(event) => setForm({ ...form, key: event.target.value })}
                    placeholder="site.some_setting"
                    className="rounded-lg border-2 border-(--border) bg-linear-to-r from-(--surface-soft)/50 to-transparent px-4 py-2.5 text-base transition hover:border-(--accent)/50 focus:bg-linear-to-r focus:from-(--surface-soft) focus:to-transparent focus:ring-2 focus:ring-(--accent)/30"
                  />
                </motion.div>

                <motion.div className="space-y-3" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.4 }}>
                  <Label htmlFor="setting-type" className="text-sm font-semibold text-brand-text-primary">Value Type</Label>
                  <Input
                    id="setting-type"
                    value={form.type}
                    onChange={(event) => setForm({ ...form, type: event.target.value })}
                    className="rounded-lg border-2 border-(--border) bg-linear-to-r from-(--surface-soft)/50 to-transparent px-4 py-2.5 text-base transition hover:border-(--accent)/50 focus:bg-linear-to-r focus:from-(--surface-soft) focus:to-transparent focus:ring-2 focus:ring-(--accent)/30"
                  />
                </motion.div>
              </div>

              <motion.div className="space-y-3" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.4 }}>
                <Label htmlFor="setting-value" className="text-sm font-semibold text-brand-text-primary">Value</Label>
                <Input
                  id="setting-value"
                  value={form.value}
                  onChange={(event) => setForm({ ...form, value: event.target.value })}
                  placeholder="Enter the setting value"
                  className="rounded-lg border-2 border-(--border) bg-linear-to-r from-(--surface-soft)/50 to-transparent px-4 py-2.5 text-base transition hover:border-(--accent)/50 focus:bg-linear-to-r focus:from-(--surface-soft) focus:to-transparent focus:ring-2 focus:ring-(--accent)/30"
                />
              </motion.div>

              <motion.div className="space-y-3" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45, duration: 0.4 }}>
                <Label htmlFor="setting-description" className="text-sm font-semibold text-brand-text-primary">Description</Label>
                <Input
                  id="setting-description"
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  placeholder="Describe the purpose of this setting"
                  className="rounded-lg border-2 border-(--border) bg-linear-to-r from-(--surface-soft)/50 to-transparent px-4 py-2.5 text-base transition hover:border-(--accent)/50 focus:bg-linear-to-r focus:from-(--surface-soft) focus:to-transparent focus:ring-2 focus:ring-(--accent)/30"
                />
              </motion.div>

              <motion.div className="flex justify-end border-t border-(--border) pt-6" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.4 }}>
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                  <Button
                    type="submit"
                    disabled={isSaving}
                    className="rounded-lg bg-linear-to-r from-(--accent) to-(--accent)/80 px-6 py-2.5 font-semibold shadow-md hover:shadow-lg disabled:opacity-60"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Create Setting
                  </Button>
                </motion.div>
              </motion.div>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      {/* Stored Settings */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.4 }}>
        <Card className="overflow-hidden border border-(--border) bg-linear-to-br from-(--surface-soft) via-(--surface-soft)/70 to-(--surface) shadow-[0_20px_60px_var(--shadow)]">
          <CardHeader className="border-b border-(--border) bg-linear-to-r from-(--surface-soft)/30 to-transparent px-6 py-4">
            <motion.div className="flex items-center gap-3" initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3, duration: 0.4 }}>
              <motion.div className="p-2 bg-linear-to-br from-green-500 to-green-600 rounded-lg" whileHover={{ scale: 1.1 }}>
                <Settings className="h-5 w-5 text-white" />
              </motion.div>
              <CardTitle className="text-2xl font-bold text-brand-text-primary">Stored Settings</CardTitle>
            </motion.div>
          </CardHeader>

          <CardContent className="space-y-4 p-6 sm:p-8">
            {isLoading ? (
              <motion.div className="space-y-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </motion.div>
            ) : settings.length === 0 ? (
              <motion.div className="rounded-xl border-2 border-dashed border-(--border) bg-linear-to-br from-(--surface-soft)/30 to-transparent p-8 text-center" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                <p className="text-base text-brand-text-muted/70">No custom settings yet. Create one above to get started.</p>
              </motion.div>
            ) : (
              <motion.div className="space-y-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ staggerChildren: 0.05 }}>
                {settings.map((setting, idx) => (
                  <motion.div
                    key={setting.id ?? setting.key}
                    className="flex flex-col gap-3 rounded-lg border border-(--border) bg-linear-to-r from-(--surface-soft)/30 to-transparent p-4 transition hover:from-(--surface-soft)/50 hover:to-(--surface-soft)/20 sm:flex-row sm:items-center sm:justify-between"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    whileHover={{ scale: 1.01 }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-brand-text-primary">{setting.key}</p>
                      <p className="mt-1 truncate text-sm text-brand-text-muted/80">{setting.value || '—'}</p>
                    </div>
                    <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(setting.key)}
                        disabled={isDeleting}
                        className="rounded-lg border-2 border-red-500/30 text-red-500 hover:bg-red-500/10 hover:text-red-600 hover:border-red-500"
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Remove
                      </Button>
                    </motion.div>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}