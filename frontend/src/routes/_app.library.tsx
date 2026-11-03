import { createFileRoute, Outlet } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { LinkTabs } from '@/components/link-tabs'

// PRD screen 7: one screen with one tab per child route.
export const Route = createFileRoute('/_app/library')({
  component: LibraryLayout,
})

function LibraryLayout() {
  const { t } = useTranslation()
  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <h1 className="text-lg font-semibold">{t('page.library')}</h1>
      <LinkTabs
        label={t('page.library')}
        tabs={[
          { to: '/library/rules', label: t('libraryTabs.rules') },
          { to: '/library/disclosures', label: t('libraryTabs.disclosures') },
          { to: '/library/building-blocks', label: t('libraryTabs.buildingBlocks') },
          { to: '/library/rate-sheet', label: t('libraryTabs.rateSheet') },
          { to: '/library/regulatory-changes', label: t('libraryTabs.regulatoryChanges') },
        ]}
      />
      <Outlet />
    </div>
  )
}
