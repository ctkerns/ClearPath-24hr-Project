import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { LinkTabs } from '@/components/link-tabs'
import { useViewer } from '@/lib/session'
import { settingsTabsFor } from '@/components/settings/settings-tabs'

// PRD screen 9: one screen with one tab per child route. Each role sees only the tabs it can change.
export const Route = createFileRoute('/_app/settings')({
  beforeLoad: ({ location, context }) => {
    const tabs = settingsTabsFor(context.viewer.role)
    // No tab for this role (Viewer, Submitter, Reviewer, Affiliate): Settings is not for them.
    if (!tabs.length) throw redirect({ to: '/dashboard' })
    // A link to a tab this role cannot change, or to /settings itself, opens the first allowed tab.
    if (!tabs.some((tab) => location.pathname.startsWith(tab.to))) throw redirect({ to: tabs[0].to })
  },
  component: SettingsLayout,
})

function SettingsLayout() {
  const viewer = useViewer()
  const { t } = useTranslation()
  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4">
      {/* No visible heading: the top bar and the tabs name the page. */}
      <h1 className="sr-only">{t('page.settings')}</h1>
      <LinkTabs label={t('page.settings')} tabs={settingsTabsFor(viewer.role).map((tab) => ({ to: tab.to, label: t(`settingsTabs.${tab.key}`) }))} />
      <Outlet />
    </div>
  )
}
