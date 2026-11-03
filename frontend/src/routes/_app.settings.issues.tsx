import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SEVERITIES } from '@/components/issues/issue-data'
import { ISSUE_DUE_DAYS_MAX, useSaveIssueDueDays, useWorkspaceSettings } from '@/components/settings/workspace-data'
import { SaveError } from '@/components/save-error'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SeverityLabel, type RiskLevel } from '@/components/ui/risk-tag'
import { Skeleton } from '@/components/ui/skeleton'
import { useSave } from '@/lib/use-save'

export const Route = createFileRoute('/_app/settings/issues')({
  component: IssuesTab,
})

/**
 * Issues (PRD F12, section 4): the default time to fix a new issue, by severity. Managers own this policy;
 * the tab shows only to Managers and Admins (settings-tabs.ts), and the server checks the role again.
 */
function IssuesTab() {
  const { t } = useTranslation()
  const settings = useWorkspaceSettings()

  if (settings.isPending) return <Skeleton className="h-48 w-full max-w-3xl" />
  if (settings.isError) return <p className="text-muted-foreground">{t('settingsIssues.loadError')}</p>
  // Keyed by the saved values, so the form starts over after a save.
  return <DueDaysForm key={JSON.stringify(settings.data.issueDueDays)} saved={settings.data.issueDueDays} />
}

function DueDaysForm({ saved }: { saved: Record<RiskLevel, number> }) {
  const { t } = useTranslation()
  const saveDays = useSaveIssueDueDays()
  const save = useSave(() => undefined)
  const [days, setDays] = useState<Record<RiskLevel, string>>({ high: String(saved.high), medium: String(saved.medium), low: String(saved.low) })

  const valid = (level: RiskLevel) => {
    const n = Number(days[level])
    return Number.isInteger(n) && n >= 1 && n <= ISSUE_DUE_DAYS_MAX
  }
  const allValid = SEVERITIES.every(valid)
  const dirty = SEVERITIES.some((level) => Number(days[level]) !== saved[level])

  return (
    <form
      className="grid max-w-3xl gap-8"
      onSubmit={(e) => {
        e.preventDefault()
        if (!dirty || !allValid || save.pending) return
        void save.run(() => saveDays(Object.fromEntries(SEVERITIES.map((level) => [level, Number(days[level])]))))
      }}
    >
      <section className="grid gap-2.5">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('settingsIssues.dueDays.heading')}</h2>
        <p className="text-sm">{t('settingsIssues.dueDays.intro')}</p>
        <div className="grid w-fit grid-cols-[6rem_auto_auto] items-center gap-x-2 gap-y-2 text-sm">
          {SEVERITIES.map((level) => (
            <div key={level} className="contents">
              <label htmlFor={`due-days-${level}`}><SeverityLabel level={level} /></label>
              <Input
                id={`due-days-${level}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={ISSUE_DUE_DAYS_MAX}
                value={days[level]}
                aria-invalid={!valid(level)}
                onChange={(e) => setDays((d) => ({ ...d, [level]: e.target.value }))}
                className="h-8 w-20 tabular-nums"
              />
              <span>{t('settingsIssues.dueDays.unit')}</span>
            </div>
          ))}
        </div>
        {!allValid && <p className="text-xs font-medium text-destructive">{t('settingsIssues.dueDays.invalid', { max: ISSUE_DUE_DAYS_MAX })}</p>}
        <ul className="grid gap-1 text-xs text-muted-foreground">
          <li>{t('settingsIssues.dueDays.override')}</li>
          <li>{t('settingsIssues.dueDays.newOnly')}</li>
        </ul>
      </section>

      <SaveError error={save.error} />

      <div className="flex gap-2 border-t pt-4">
        <Button type="submit" size="sm" disabled={!dirty || !allValid || save.pending}>{t('settingsIssues.save')}</Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!dirty}
          onClick={() => setDays({ high: String(saved.high), medium: String(saved.medium), low: String(saved.low) })}
        >
          {t('settingsIssues.discard')}
        </Button>
      </div>
    </form>
  )
}
