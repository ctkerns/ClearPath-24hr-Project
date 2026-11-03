import { createFileRoute, Outlet } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { LinkTabs } from '@/components/link-tabs'
import { NotAvailable } from '@/components/not-available'
import { useViewer } from '@/lib/session'

// PRD screen 7: one screen with one tab per child route.
export const Route = createFileRoute('/_app/library')({
  component: LibraryLayout,
})

function LibraryLayout() {
  const { t } = useTranslation()
  // The library is for internal users only: its API gives affiliates 403 (PRD section 4, R4).
  // Not rendering the Outlet means no tab asks the API.
  const viewer = useViewer()
  if (viewer.role === 'affiliate') return <NotAvailable page={t('page.library')} />
  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4">
      {/* No visible heading: the active tab in the top bar already names the page. */}
      <h1 className="sr-only">{t('page.library')}</h1>
      <LinkTabs
        label={t('page.library')}
        tabs={[
          { to: '/library/products', label: t('libraryTabs.products') },
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
