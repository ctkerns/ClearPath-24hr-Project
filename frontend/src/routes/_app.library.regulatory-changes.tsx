import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderPage } from '@/components/placeholder-page'

export const Route = createFileRoute('/_app/library/regulatory-changes')({
  component: RegulatoryChangesTab,
})

function RegulatoryChangesTab() {
  return (
    <PlaceholderPage
      screen="7"
      route="/library/regulatory-changes"
      notes={[
        'Regulatory change queue (F7), with a count of changes waiting for a Manager.',
      ]}
    />
  )
}
