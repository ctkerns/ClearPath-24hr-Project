import { createFileRoute } from '@tanstack/react-router'
import { Check, Lock, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadError } from '@/components/load-error'
import { useViewer } from '@/lib/session'
import { hasRole } from '@/components/settings/user-data'
import {
  EXPIRY_WARNING_DAYS,
  US_STATES,
  useResetDemo,
  useSaveWorkspaceSettings,
  useWorkspaceSettings,
  type WorkspaceSettings,
} from '@/components/settings/workspace-data'
import { ResetDemoDialog } from '@/components/settings/workspace-reset-dialog'
import { TimeZoneSelect } from '@/components/settings/time-zone-select'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/i18n/format'
import { useWorkspace } from '@/lib/workspace'
import { useSave } from '@/lib/use-save'
import { SaveError } from '@/components/save-error'

export const Route = createFileRoute('/_app/settings/workspace')({
  component: WorkspaceTab,
})

/** Workspace settings (PRD section 10): details, licensed states (F7), approval expiry (F15), time zone, and the demo reset. Admins only. */
function WorkspaceTab() {
  const viewer = useViewer()
  const { t } = useTranslation()
  const workspace = useWorkspace()
  const settings = useWorkspaceSettings()
  const resetDemo = useResetDemo()
  const canEdit = hasRole(viewer.role, 'admin')
  const [confirming, setConfirming] = useState(false)
  const [resetAt, setResetAt] = useState<string>()

  return (
    <div className="grid max-w-3xl gap-8">
      {!canEdit && (
        <p className="-mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3.5" aria-hidden="true" />
          {t('settingsWorkspace.readOnly')}
        </p>
      )}

      <Section title={t('settingsWorkspace.details.heading')}>
        <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t('settingsWorkspace.details.name')}</dt>
          <dd className="font-medium">{workspace.name}</dd>
          <dt className="text-muted-foreground">{t('settingsWorkspace.details.type')}</dt>
          <dd>
            {t(workspace.isDemo ? 'settingsWorkspace.details.demo' : 'settingsWorkspace.details.real')}
            <span className="block text-xs text-muted-foreground">
              {t(workspace.isDemo ? 'settingsWorkspace.details.demoHelp' : 'settingsWorkspace.details.realHelp')}
            </span>
          </dd>
        </dl>
      </Section>

      {settings.isPending ? (
        <Skeleton className="h-80 w-full" />
      ) : settings.isError ? (
        <LoadError error={settings.error} what={t('settingsWorkspace.what')} onRetry={() => settings.refetch()} />
      ) : (
        // Keyed by the saved values, so the form starts over after a save or a reset.
        <SettingsForm key={JSON.stringify(settings.data)} settings={settings.data} canEdit={canEdit} />
      )}

      {workspace.isDemo && (
        <Section title={t('settingsWorkspace.reset.heading')}>
          <p className="text-sm">{t('settingsWorkspace.reset.intro')}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="destructive-outline" size="sm" disabled={!canEdit} onClick={() => setConfirming(true)}>
              <RotateCcw aria-hidden="true" />
              {t('settingsWorkspace.reset.action')}
            </Button>
            {resetAt && (
              <span role="status" className="flex items-center gap-1 text-xs text-risk-low">
                <Check className="size-3.5" aria-hidden="true" />
                {t('settingsWorkspace.reset.done', { time: formatDateTime(resetAt) })}
              </span>
            )}
          </div>
          <ResetDemoDialog
            open={confirming}
            onClose={() => setConfirming(false)}
            onConfirm={() => {
              void resetDemo()
              setResetAt(new Date().toISOString())
            }}
          />
        </Section>
      )}
    </div>
  )
}

function SettingsForm({ settings, canEdit }: { settings: WorkspaceSettings; canEdit: boolean }) {
  const { t } = useTranslation()
  const saveSettings = useSaveWorkspaceSettings()
  // The form starts over with the saved values (the parent keys it by them), so nothing to do after a save.
  const save = useSave(() => undefined)
  const [states, setStates] = useState(settings.licensedStates)
  const [days, setDays] = useState(String(settings.approvalDays))
  const [timeZone, setTimeZone] = useState(settings.timeZone)

  const dayCount = Number(days)
  const daysValid = Number.isInteger(dayCount) && dayCount >= 15 && dayCount <= 365
  const removed = settings.licensedStates.filter((s) => !states.includes(s))
  const dirty =
    removed.length > 0 || states.length !== settings.licensedStates.length || dayCount !== settings.approvalDays || timeZone !== settings.timeZone
  const valid = states.length > 0 && daysValid

  return (
    <form
      className="grid gap-8"
      onSubmit={(e) => {
        e.preventDefault()
        if (!dirty || !valid || save.pending) return
        void save.run(() => saveSettings({ licensedStates: US_STATES.filter((s) => states.includes(s)), approvalDays: dayCount, timeZone }))
      }}
    >
      <Section title={t('settingsWorkspace.states.heading')}>
        <p className="text-sm">{t('settingsWorkspace.states.intro')}</p>
        <p className="text-xs text-muted-foreground">{t('settingsWorkspace.states.count', { count: states.length })}</p>
        <fieldset disabled={!canEdit} className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border px-3 py-2.5 sm:grid-cols-3 md:grid-cols-4">
          <legend className="sr-only">{t('settingsWorkspace.states.heading')}</legend>
          {US_STATES.map((s) => (
            <label key={s} className="flex items-center gap-2 py-0.5 text-sm has-disabled:cursor-not-allowed">
              <Checkbox
                checked={states.includes(s)}
                disabled={!canEdit}
                onCheckedChange={(c) => setStates((list) => (c === true ? [...list, s] : list.filter((x) => x !== s)))}
              />
              <span className="w-6 font-mono text-xs text-muted-foreground">{s}</span>
              <span className="truncate">{t(`settingsWorkspace.stateName.${s}`)}</span>
            </label>
          ))}
        </fieldset>
        {states.length === 0 && <p className="text-xs font-medium text-destructive">{t('settingsWorkspace.states.none')}</p>}
        {removed.length > 0 && (
          <p className="text-xs text-risk-medium">{t('settingsWorkspace.states.removed', { states: removed.join(', '), count: removed.length })}</p>
        )}
      </Section>

      <Section title={t('settingsWorkspace.expiry.heading')}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="approval-days">{t('settingsWorkspace.expiry.label')}</label>
          <Input
            id="approval-days"
            type="number"
            inputMode="numeric"
            min={15}
            max={365}
            value={days}
            disabled={!canEdit}
            aria-invalid={!daysValid}
            onChange={(e) => setDays(e.target.value)}
            className="h-8 w-20 tabular-nums"
          />
          <span>{t('settingsWorkspace.expiry.unit')}</span>
        </div>
        {!daysValid && <p className="text-xs font-medium text-destructive">{t('settingsWorkspace.expiry.invalid')}</p>}
        <ul className="grid gap-1 text-xs text-muted-foreground">
          <li>{t('settingsWorkspace.expiry.warning', { days: EXPIRY_WARNING_DAYS })}</li>
          <li>{t('settingsWorkspace.expiry.earlier')}</li>
          <li>{t('settingsWorkspace.expiry.newOnly')}</li>
        </ul>
      </Section>

      <Section title={t('settingsWorkspace.timeZone.heading')}>
        <p className="text-sm">{t('settingsWorkspace.timeZone.intro')}</p>
        <div className="grid gap-1.5 text-sm">
          <label htmlFor="time-zone">{t('settingsWorkspace.timeZone.label')}</label>
          <TimeZoneSelect id="time-zone" value={timeZone} onChange={setTimeZone} disabled={!canEdit} />
        </div>
        <ul className="grid gap-1 text-xs text-muted-foreground">
          <li>{t('settingsWorkspace.timeZone.uses')}</li>
          <li>{t('settingsWorkspace.timeZone.dates')}</li>
          <li>{t('settingsWorkspace.timeZone.times')}</li>
        </ul>
      </Section>

      <SaveError error={save.error} />

      {canEdit && (
        <div className="flex gap-2 border-t pt-4">
          <Button type="submit" size="sm" disabled={!dirty || !valid || save.pending}>{t('settingsWorkspace.save')}</Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!dirty}
            onClick={() => {
              setStates(settings.licensedStates)
              setDays(String(settings.approvalDays))
              setTimeZone(settings.timeZone)
            }}
          >
            {t('settingsWorkspace.discard')}
          </Button>
        </div>
      )}
    </form>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2.5">
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  )
}
