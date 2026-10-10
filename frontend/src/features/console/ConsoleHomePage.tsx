import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ShieldAlert } from 'lucide-react'

import { useAppSelector } from '../../app/hooks'
import { selectCurrentUser } from '../auth/authSlice'
import { getUserPermissions } from '../auth/roleExperience'
import { Card, CardContent } from '../../components/ui/Card'
import { DynamicIcon } from '../../components/DynamicIcon'
import { useConsoleBase } from './consoleBase'
import { selectConsoleModules } from './config/consoleNav.config'

interface ConsoleHomePageProps {
  title: string
  subtitle: string
  emptyTitle: string
  emptyMessage: string
}

/**
 * The landing page of the moderator and staff consoles.
 *
 * It only offers modules the resolved permissions unlock, and when those permissions unlock nothing
 * it says so plainly instead of showing an empty or broken console.
 */
export function ConsoleHomePage({ title, subtitle, emptyTitle, emptyMessage }: ConsoleHomePageProps) {
  const user = useAppSelector(selectCurrentUser)
  const base = useConsoleBase()
  const modules = selectConsoleModules(getUserPermissions(user))

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
      <div>
        <h1 className="text-3xl font-semibold text-(--text-primary)">{title}</h1>
        <p className="mt-1 text-(--text-muted)">{subtitle}</p>
      </div>

      {modules.length === 0 ? (
        <Card className="border-(--border) p-6">
          <CardContent className="flex flex-col items-start gap-3 p-0">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-500/15 text-amber-500">
              <ShieldAlert className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-(--text-primary)">{emptyTitle}</h2>
              <p className="mt-1 max-w-2xl text-sm text-(--text-muted)">{emptyMessage}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {modules.map((module) => (
            <motion.div key={module.path} whileHover={{ y: -4 }}>
              <Link
                to={`${base}/${module.path}`}
                className="flex h-full items-center gap-4 rounded-3xl border border-(--border) bg-(--surface-soft)/70 p-5 transition hover:border-(--accent)/40 hover:bg-(--surface)"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-(--accent)/15 text-(--accent)">
                  <DynamicIcon name={module.icon} className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-(--text-primary)">{module.label}</span>
                  <span className="block text-xs text-(--text-muted)">Open module</span>
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  )
}
