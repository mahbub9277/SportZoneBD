import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '../../../components/ui/Badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/Card'
import { Switch } from '../../../components/ui/Switch'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../components/ui/AlertDialog'
import type { AutomationSwitchState } from '../automationSwitches.api'
import { describeAutomationSwitch } from '../automationSwitchState'

interface AutomationSwitchCardProps {
  state?: AutomationSwitchState
  isFetching: boolean
  isSaving: boolean
  isError: boolean
  hasPermission: boolean
  /** What stays available while the switch is off, in this subsystem's own words. */
  unaffectedNote: string
  onToggle: (enabled: boolean) => void
}

const TONE_CLASSES: Record<'accent' | 'muted' | 'warning' | 'danger', string> = {
  accent: 'border-(--accent)/40 bg-(--accent)/10 text-(--accent)',
  muted: 'border-(--border) bg-(--surface-soft) text-(--text-muted)',
  warning: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
  danger: 'border-(--danger)/40 bg-(--danger-soft) text-(--danger)',
}

/**
 * One automation master switch.
 *
 * The control reads its state from the backend and shows the value the backend confirmed; a request in
 * flight or a failed request never moves the switch on its own. Turning a switch off asks for
 * confirmation, because it stops automatic work that the platform is otherwise performing continuously.
 */
export function AutomationSwitchCard({
  state,
  isFetching,
  isSaving,
  isError,
  hasPermission,
  unaffectedNote,
  onToggle,
}: AutomationSwitchCardProps) {
  const [confirmingDisable, setConfirmingDisable] = useState(false)
  const view = describeAutomationSwitch({ state, isFetching, isSaving, isError, hasPermission })

  const handleCheckedChange = (next: boolean) => {
    if (!next) {
      setConfirmingDisable(true)
      return
    }
    onToggle(true)
  }

  return (
    <Card className="border border-(--border) bg-(--surface)/70 p-6 shadow-[0_20px_60px_var(--shadow)] sm:p-7">
      <CardHeader className="flex flex-col gap-4 px-0 pt-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-3">
            {state?.label ?? 'Automation switch'}
            <Badge variant="outline" className={`rounded-full border px-3 py-1 text-xs font-semibold ${TONE_CLASSES[view.tone]}`}>
              {view.statusLabel}
            </Badge>
            {isFetching && !isSaving && <Loader2 className="h-4 w-4 animate-spin text-(--text-muted)" aria-hidden />}
          </CardTitle>
          <CardDescription className="mt-2 max-w-3xl text-sm leading-6 text-(--text-muted)">
            {state?.description ?? 'Automated background work controlled by a persisted, server-enforced switch.'}
          </CardDescription>
        </div>

        <div className="flex items-center gap-3">
          <Switch
            checked={view.enabled}
            disabled={!view.canToggle || isSaving || isFetching}
            onCheckedChange={handleCheckedChange}
            aria-label={state ? `${state.label} automation` : 'Automation switch'}
          />
          <span className="text-sm font-medium text-(--text-primary)">{view.statusLabel}</span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 px-0 pb-0">
        <p className={`text-sm leading-6 ${view.tone === 'danger' ? 'text-(--danger)' : view.tone === 'warning' ? 'text-amber-300' : 'text-(--text-muted)'}`}>
          {view.message}
        </p>

        <p className="text-xs leading-5 text-(--text-muted)">{unaffectedNote}</p>

        {!hasPermission && (
          <p className="flex items-center gap-2 text-xs leading-5 text-(--text-muted)">
            <ShieldCheck className="h-4 w-4" aria-hidden />
            You can see this state but not change it: the settings permission is required.
          </p>
        )}

        {state?.degradedReason && view.state === 'unavailable' && (
          <p className="flex items-start gap-2 text-xs leading-5 text-(--danger)">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {state.degradedReason}
          </p>
        )}

        {view.lastConfirmedAt && (
          <p className="text-xs text-(--text-muted)">
            Last confirmed by the server: {new Date(view.lastConfirmedAt).toLocaleString()}
          </p>
        )}

        {state && state.dependencies.some((dependency) => !dependency.ok) && (
          <ul className="space-y-1 text-xs leading-5 text-(--text-muted)">
            {state.dependencies
              .filter((dependency) => !dependency.ok)
              .map((dependency) => (
                <li key={dependency.name}>· {dependency.detail}</li>
              ))}
          </ul>
        )}
      </CardContent>

      <AlertDialog open={confirmingDisable} onOpenChange={setConfirmingDisable}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off {state?.label ?? 'this automation'}?</AlertDialogTitle>
            <AlertDialogDescription>
              Automatic work stops on every backend instance within a few seconds and no new work is produced
              while it stays off. {unaffectedNote}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmingDisable(false)
                onToggle(false)
              }}
            >
              Turn off
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
