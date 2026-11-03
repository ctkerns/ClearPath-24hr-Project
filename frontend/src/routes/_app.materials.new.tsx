import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PlaceholderPage } from '@/components/placeholder-page'

export const Route = createFileRoute('/_app/materials/new')({
  component: NewMaterialPage,
})

function NewMaterialPage() {
  const { t } = useTranslation()
  return (
    <PlaceholderPage
      title={t('page.newMaterial')}
      screen="5"
      route="/materials/new"
      notes={[
        'Submit form (F3): text, images, PDF or URL.',
        'Metadata: product, channel, target states (required; "Nationwide" is one choice), targeting, launch and end dates, destination URL, claim proof files.',
        'Optional AI self-check before submit (P1).',
        'Shares its form with /materials/$materialId/new-version.',
      ]}
    />
  )
}
