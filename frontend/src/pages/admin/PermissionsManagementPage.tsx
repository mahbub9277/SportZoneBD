import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Skeleton } from '../../components/ui/Skeleton'
import { AlertCircle } from 'lucide-react'
import { useGetPermissionsQuery } from '../../features/admin/roles.api'
import { motion } from 'framer-motion'
import { ShieldCheck } from 'lucide-react'

export default function PermissionsManagementPage() {
  const { data: permissions = [], isLoading, isError } = useGetPermissionsQuery()

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-semibold text-(--text-primary)"><motion.span className="grid h-10 w-10 place-items-center rounded-xl bg-linear-to-br from-cyan-500 to-blue-600 text-white" whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}><ShieldCheck className="h-5 w-5" /></motion.span>Permissions</h1>
        <p className="mt-1 text-(--text-muted)">Review the permission keys used by the admin experience.</p>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} whileHover={{ y: -4 }}><Card className="border-(--border)">
        <CardHeader>
          <CardTitle>Available permissions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)
          ) : isError ? (
            <div className="flex items-center gap-2 text-sm text-red-500"><AlertCircle size={16} /> Could not load permissions.</div>
          ) : permissions.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-(--text-muted)"><AlertCircle size={16} /> No permissions found.</div>
          ) : (
            permissions.map((permission) => (
              <div key={permission.id} className="rounded-2xl border border-(--border) bg-(--surface-soft)/70 p-4">
                <p className="font-semibold text-(--text-primary)">{permission.key}</p>
                <p className="text-sm text-(--text-muted)">{permission.description || 'No description provided.'}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card></motion.div>
    </motion.div>
  )
}
