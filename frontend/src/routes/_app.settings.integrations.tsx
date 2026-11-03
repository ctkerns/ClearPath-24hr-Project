import { createFileRoute } from '@tanstack/react-router'
import { Info, Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useViewer } from '@/lib/session'
import { INTEGRATION_GROUPS, ownerCandidates, providerInfo, useIntegrations } from '@/components/settings/integration-data'
import { IntegrationListHeader, IntegrationRow } from '@/components/settings/integration-row'
import { hasRole, useUsers } from '@/components/settings/user-data'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkspace } from '@/lib/workspace'

export const Route = createFileRoute('/_app/settings/integrations')({
  component: IntegrationsTab,
})

/**
 * Connectors (PRD F11): status, Verified or Unverified, last sync and Sync now, grouped by what each one does.
 * Only Admins see the tab and connect, disconnect, sync or set default owners; the server checks the role (PRD section 4).
 */
function IntegrationsTab() {
  const viewer = useViewer()
  const { t } = useTranslation()
  const { isDemo } = useWorkspace()
  const integrations = useIntegrations()
  const users = useUsers()
  const canEdit = hasRole(viewer.role, 'admin')

  if (integrations.isPending) return <IntegrationsSkeleton />
  if (integrations.isError) return <p className="text-muted-foreground">{t('settingsIntegrations.loadError')}</p>

  const all = integrations.data
  const owners = ownerCandidates(users.data ?? [])
  const connected = all.filter((i) => i.status === 'connected').length
  const errors = all.filter((i) => i.status === 'error').length

  return (
    <div className="grid gap-4">
      <header className="grid gap-2">
        <p className="text-sm">
          {t('settingsIntegrations.summary', { connected, total: all.length })}
          {errors > 0 && <span className="font-medium text-risk-high"> · {t('settingsIntegrations.summaryErrors', { count: errors })}</span>}
        </p>
        {isDemo && (
          <p className="flex max-w-3xl gap-2 rounded-md bg-info-soft px-3 py-2 text-xs text-info">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {t('settingsIntegrations.demoNote')}
          </p>
        )}
        {!canEdit && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden="true" />
            {t('settingsIntegrations.readOnly')}
          </p>
        )}
      </header>

      <div className="overflow-hidden rounded-md border [&>section:last-child_li:last-child]:border-b-0">
        <IntegrationListHeader />
        {INTEGRATION_GROUPS.map((group) => {
          const items = all.filter((i) => providerInfo[i.provider].group === group)
          if (!items.length) return null
          return (
            <section key={group} aria-labelledby={`integration-group-${group}`}>
              <h2
                id={`integration-group-${group}`}
                className="border-b bg-muted/40 px-3 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {t(`settingsIntegrations.group.${group}`)}
                <span className="ml-2 font-normal tracking-normal normal-case">{t(`settingsIntegrations.groupHint.${group}`)}</span>
              </h2>
              <ul>
                {items.map((i) => <IntegrationRow key={i.id} integration={i} owners={owners} canEdit={canEdit} />)}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function IntegrationsSkeleton() {
  return (
    <div className="grid gap-3">
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-96 w-full" />
    </div>
  )
}
