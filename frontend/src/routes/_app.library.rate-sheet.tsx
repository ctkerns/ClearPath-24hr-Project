import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderPage } from '@/components/placeholder-page'

export const Route = createFileRoute('/_app/library/rate-sheet')({
  component: RateSheetTab,
})

function RateSheetTab() {
  return (
    <PlaceholderPage
      screen="7"
      route="/library/rate-sheet"
      notes={[
        'Current APR ranges, fees and offer terms by product, with effective dates (F8).',
        'Managers upload a CSV.',
      ]}
    />
  )
}
