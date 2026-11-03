import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PlaceholderPage } from '@/components/placeholder-page'

export const Route = createFileRoute('/_app/materials/$materialId/new-version')({
  component: NewVersionPage,
})

function NewVersionPage() {
  const { t } = useTranslation()
  const { materialId } = Route.useParams()
  return (
    <PlaceholderPage
      title={`${t('page.newVersion')} · ${materialId}`}
      screen="5"
      route="/materials/$materialId/new-version"
      notes={[
        'Same submit form as /materials/new, filled in from the current version.',
        'Creates a new version and moves the material to Submitted.',
      ]}
    />
  )
}
