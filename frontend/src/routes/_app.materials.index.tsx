import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PlaceholderPage } from '@/components/placeholder-page'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/_app/materials/')({
  component: MaterialsPage,
})

function MaterialsPage() {
  const { t } = useTranslation()
  return (
    <PlaceholderPage
      title={t('page.materials')}
      screen="3"
      route="/materials"
      notes={[
        'Searchable, filterable list of all materials (F2): channel, product, status, required groups, submitter, affiliate, approval ID, expiry date.',
        'Live status column and filter. This list is also the monitoring view (F10).',
        '"New submission" button.',
        'Affiliates see only their own materials (R4).',
      ]}
    >
      <div className="flex flex-wrap gap-2">
        <Button asChild><Link to="/materials/new">{t('page.newMaterial')}</Link></Button>
        <Button asChild variant="outline">
          <Link to="/materials/$materialId" params={{ materialId: 'MAT-0142' }}>MAT-0142 (sample)</Link>
        </Button>
      </div>
    </PlaceholderPage>
  )
}
