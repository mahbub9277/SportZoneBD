import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Database, HardDrive, RefreshCw, Wifi, TrendingUp, Calendar, Filter, Zap, Cloud } from 'lucide-react'
import { useGetCloudinaryStorageUsageQuery } from '../../features/admin/system.api'

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 2 : 0)} ${units[index]}`
}

function calculateDailyAverage(totalBytes: number): number {
  return Math.ceil(totalBytes / 30)
}

function renderAnimatedProgress(used: number, total: number, delay = 0) {
  const percentage = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  const isWarning = percentage > 80
  const isDanger = percentage > 95

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="space-y-2"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-(--text-primary)">{formatBytes(used)}</span>
        <span className="text-xs text-(--text-muted)">of {formatBytes(total)}</span>
      </div>
      <div className="relative h-3 overflow-hidden rounded-full bg-(--surface-soft)">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ delay: delay + 0.2, duration: 0.8, ease: 'easeOut' }}
          className={`h-full rounded-full transition-colors ${
            isDanger ? 'bg-linear-to-r from-red-500 to-red-600' :
            isWarning ? 'bg-linear-to-r from-amber-500 to-orange-600' :
            'bg-linear-to-r from-cyan-500 to-blue-600'
          }`}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-(--text-muted)">{percentage}% used</span>
        <span className={`text-xs font-medium ${isDanger ? 'text-red-500' : isWarning ? 'text-amber-500' : 'text-green-500'}`}>
          {isWarning || isDanger ? (
            <span className="inline-flex items-center gap-1">
              <Zap className="h-3 w-3" /> Warning
            </span>
          ) : (
            'Normal'
          )}
        </span>
      </div>
    </motion.div>
  )
}

export default function StorageManagementPage() {
  const { data: usage, isLoading, isFetching, isError, refetch } = useGetCloudinaryStorageUsageQuery()
  const [filterType, setFilterType] = useState<'all' | 'storage' | 'bandwidth'>('all')

  const storageItems = usage ? [
    { label: 'Storage', used: usage.storage.usedBytes, total: usage.storage.limitBytes, icon: HardDrive, type: 'storage', color: 'from-blue-500 to-cyan-600' },
    { label: 'Bandwidth', used: usage.bandwidth.usedBytes, total: usage.bandwidth.limitBytes, icon: Wifi, type: 'bandwidth', color: 'from-purple-500 to-pink-600' },
  ] : []

  const dailyStorageLimit = usage ? calculateDailyAverage(usage.storage.limitBytes ?? 0) : 0
  const dailyStorageUsage = usage ? calculateDailyAverage(usage.storage.usedBytes ?? 0) : 0

  const filteredItems = filterType === 'all' ? storageItems : storageItems.filter(item => item.type === filterType)

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <h1 className="text-3xl font-bold text-(--text-primary)">Storage Management</h1>
        <p className="mt-2 text-(--text-muted)">Monitor Cloudinary cloud storage, bandwidth usage, and daily limits in real-time.</p>
      </motion.div>

      {isError ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <Card className="border-(--danger)/30 bg-(--danger-soft) p-6 text-(--danger) flex items-center gap-3">
            <Database className="h-5 w-5 shrink-0" />
            <span>Unable to load Cloudinary usage data. Please try refreshing.</span>
          </Card>
        </motion.div>
      ) : (
        <>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="grid gap-4 sm:grid-cols-2"
          >
            {filteredItems.map((item, idx) => {
              const Icon = item.icon
              const percentage = item.total > 0 ? Math.min(100, Math.round((item.used / item.total) * 100)) : 0
              const isDanger = percentage > 95
              const isWarning = percentage > 80

              return (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ delay: 0.1 + idx * 0.1, duration: 0.4 }}
                >
                  <Card className={`overflow-hidden border transition-all hover:shadow-lg ${
                    isDanger ? 'border-(--danger)/50 bg-(--danger-soft)/30' :
                    isWarning ? 'border-amber-500/30 bg-amber-500/5' :
                    'border-(--border) hover:border-(--accent)/50'
                  } p-6`}>
                    <div className="flex items-start justify-between mb-4">
                      <motion.div
                        className={`p-3 rounded-xl bg-linear-to-br ${item.color}`}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        <Icon className="h-5 w-5 text-white" />
                      </motion.div>
                      <div className="text-right">
                        <h3 className="font-semibold text-(--text-primary)text-sm">{item.label}</h3>
                        <p className="text-xs text-(--text-muted)">{percentage}% capacity</p>
                      </div>
                    </div>
                    {isLoading ? (
                      <div className="space-y-3">
                        <div className="h-4 animate-pulse rounded-full bg-(--surface-soft)" />
                        <div className="h-3 animate-pulse rounded-full bg-(--surface-soft)" />
                      </div>
                    ) : (
                      renderAnimatedProgress(item.used, item.total, 0.2 + idx * 0.1)
                    )}
                  </Card>
                </motion.div>
              )
            })}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3 }}
            className="grid gap-4 sm:grid-cols-2"
          >
            <Card className="border-(--border) bg-(--surface-soft)/40 overflow-hidden">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Calendar className="h-5 w-5 text-(--accent)" />
                  Daily Storage Limit
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {isLoading ? (
                  <div className="space-y-2">
                    <div className="h-4 animate-pulse rounded bg-(--surface-soft)" />
                    <div className="h-3 animate-pulse rounded bg-(--surface-soft)" />
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-(--text-muted)">Daily Average Usage</span>
                        <span className="font-semibold text-(--text-primary)">{formatBytes(dailyStorageUsage)}</span>
                      </div>
                      <div className="relative h-3 overflow-hidden rounded-full bg-(--surface-soft)">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(100, (dailyStorageUsage / dailyStorageLimit) * 100)}%` }}
                          transition={{ delay: 0.5, duration: 0.8 }}
                          className="h-full bg-linear-to-r from-green-500 to-emerald-600"
                        />
                      </div>
                      <div className="flex justify-between text-xs text-(--text-muted)">
                        <span>{formatBytes(dailyStorageUsage)}</span>
                        <span>{formatBytes(dailyStorageLimit)} daily limit</span>
                      </div>
                    </div>
                    <div className="rounded-lg bg-(--background) p-3 border border-(--border)">
                      <p className="text-xs text-(--text-muted)">
                        <span className="font-semibold text-(--accent)">Info: </span>
                        Daily limit is calculated as monthly total ÷ 30 days
                      </p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="border-(--border) bg-(--surface-soft)/40 overflow-hidden">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Cloud className="h-5 w-5 text-(--accent)" />
                  Cloudinary Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {isLoading ? (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-3 animate-pulse rounded bg-(--surface-soft)" />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between p-2 rounded-lg bg-(--background)/50">
                      <span className="text-(--text-muted)">Provider</span>
                      <span className="font-semibold text-(--text-primary)">Cloudinary</span>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-lg bg-(--background)/50">
                      <span className="text-(--text-muted)">API Requests</span>
                      <span className="font-semibold text-(--accent)">{usage?.requests ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-lg bg-(--background)/50">
                      <span className="text-(--text-muted)">Last Updated</span>
                      <span className="font-mono text-xs text-(--text-muted)">
                        {usage?.updatedAt ? new Date(usage.updatedAt).toLocaleTimeString() : '—'}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.5 }}
          >
            <Card className="border-(--border) bg-(--surface-soft)/40 overflow-hidden">
              <CardHeader className="pb-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Filter className="h-5 w-5 text-(--accent)" />
                    Storage Management
                  </CardTitle>
                  <div className="flex flex-wrap gap-2">
                    {(['all', 'storage', 'bandwidth'] as const).map(type => (
                      <motion.button
                        key={type}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setFilterType(type)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all ${
                          filterType === type
                            ? 'bg-(--accent) text-white shadow-lg'
                            : 'bg-(--surface-soft) text-(--text-muted) hover:bg-(--surface-soft)/70'
                        }`}
                      >
                        {type.charAt(0).toUpperCase() + type.slice(1)}
                      </motion.button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-(--text-primary) flex items-center gap-2">
                      <Database className="h-4 w-4 text-(--accent)" />
                      Cloudinary Real-Time Data
                    </p>
                    <p className="text-xs text-(--text-muted)">
                      {isLoading ? 'Loading...' : `Last updated: ${usage?.updatedAt ? new Date(usage.updatedAt).toLocaleString() : '—'}`}
                    </p>
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => void refetch()}
                    disabled={isFetching}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-(--accent) text-white text-sm font-medium transition-all hover:shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <RefreshCw className={isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                    {isFetching ? 'Refreshing...' : 'Refresh Now'}
                  </motion.button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </>
      )}
    </div>
  )
}
