import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderPage } from '@/components/placeholder-page'

export const Route = createFileRoute('/_app/library/disclosures')({
  component: DisclosuresTab,
})

function DisclosuresTab() {
  return (
    <PlaceholderPage
      screen="7"
      route="/library/disclosures"
      notes={[
        'Approved disclosure texts, versioned, with the products and states they apply to (F8).',
      ]}
    />
  )
}
