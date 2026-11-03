import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PlaceholderPage } from '@/components/placeholder-page'

export const Route = createFileRoute('/_app/home')({
  component: HomePage,
})

function HomePage() {
  const { t } = useTranslation()
  return (
    <PlaceholderPage
      title={t('page.home')}
      screen="2"
      route="/home"
      notes={[
        'Dashboard by role: my queue, my submissions, my issues.',
        '"New submission" button, which opens /materials/new.',
      ]}
    />
  )
}
