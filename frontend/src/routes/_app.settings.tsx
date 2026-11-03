import { createFileRoute, Outlet } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { LinkTabs } from '@/components/link-tabs'

// PRD screen 9: one screen with one tab per child route.
export const Route = createFileRoute('/_app/settings')({
  component: SettingsLayout,
})

function SettingsLayout() {
  const { t } = useTranslation()
  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <h1 className="text-lg font-semibold">{t('page.settings')}</h1>
      <LinkTabs
        label={t('page.settings')}
        tabs={[
          { to: '/settings/users', label: t('settingsTabs.users') },
          { to: '/settings/reviewer-groups', label: t('settingsTabs.reviewerGroups') },
          { to: '/settings/routing', label: t('settingsTabs.routing') },
          { to: '/settings/integrations', label: t('settingsTabs.integrations') },
          { to: '/settings/workspace', label: t('settingsTabs.workspace') },
        ]}
      />
      <Outlet />
    </div>
  )
}
