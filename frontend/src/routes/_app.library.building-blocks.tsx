import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderPage } from '@/components/placeholder-page'

export const Route = createFileRoute('/_app/library/building-blocks')({
  component: BuildingBlocksTab,
})

function BuildingBlocksTab() {
  return (
    <PlaceholderPage
      screen="7"
      route="/library/building-blocks"
      notes={[
        'Pre-approved headlines, claims and disclosures (F9), each with products, states and expiry date.',
      ]}
    />
  )
}
