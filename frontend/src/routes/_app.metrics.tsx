import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PlaceholderPage } from '@/components/placeholder-page'

export const Route = createFileRoute('/_app/metrics')({
  component: MetricsPage,
})

function MetricsPage() {
  const { t } = useTranslation()
  return (
    <PlaceholderPage
      title={t('page.metrics')}
      screen="8"
      route="/metrics"
      notes={[
        'Throughput and quality metrics from PRD section 2 (F14).',
        'Filters: date, channel, product, required group.',
      ]}
    />
  )
}
