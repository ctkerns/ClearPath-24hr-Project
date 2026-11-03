import { createFileRoute } from '@tanstack/react-router'
import { Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useReviewerGroups } from '@/components/settings/group-data'
import { canManageRouting, useRouting } from '@/components/settings/routing-data'
import { ChangeTypesSection, DefaultGroupSection, LighterPathSection } from '@/components/settings/routing-paths'
import { RoutingRules } from '@/components/settings/routing-rules'
import { RoutingTest } from '@/components/settings/routing-test'
import { Skeleton } from '@/components/ui/skeleton'
import { useViewer } from '@/lib/session'

export const Route = createFileRoute('/_app/settings/routing')({
  component: RoutingTab,
})

/**
 * Routing (PRD F6, screen 9): who must review an item. Read top to bottom like a policy:
 * the rules, the default group, then the lighter path and the changes that may take it.
 * The "Test routing" panel runs the rules on an example item.
 */
function RoutingTab() {
  const viewer = useViewer()
  const { t } = useTranslation()
  const routing = useRouting()
  const groups = useReviewerGroups()
  const canEdit = canManageRouting(viewer.role)

  if (routing.isPending || groups.isPending) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (!routing.data || !groups.data) return <p className="text-sm text-destructive">{t('settingsRouting.loadError')}</p>

  const settings = routing.data
  const groupList = groups.data
  const defaultGroup = groupList.find((g) => g.isDefault)
  const lighterPathGroup = settings.lighterPathGroupId ? groupList.find((g) => g.id === settings.lighterPathGroupId) : defaultGroup

  return (
    <div className="grid gap-4">
      {!canEdit && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3.5" aria-hidden="true" />
          {t('settingsRouting.readOnly')}
        </p>
      )}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
        <div className="grid min-w-0 content-start gap-8">
          <RoutingRules rules={settings.rules} groups={groupList} canEdit={canEdit} />
          <DefaultGroupSection settings={settings} groups={groupList} canEdit={canEdit} />
          <LighterPathSection settings={settings} groups={groupList} canEdit={canEdit} />
          <ChangeTypesSection settings={settings} canEdit={canEdit} />
        </div>
        <aside className="content-start lg:sticky lg:top-16 lg:self-start">
          <RoutingTest rules={settings.rules} groups={groupList} lighterPathGroup={lighterPathGroup} />
        </aside>
      </div>
    </div>
  )
}
