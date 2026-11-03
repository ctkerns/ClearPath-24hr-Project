import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderPage } from '@/components/placeholder-page'

export const Route = createFileRoute('/_app/settings/routing')({
  component: RoutingTab,
})

function RoutingTab() {
  return (
    <PlaceholderPage
      screen="9"
      route="/settings/routing"
      notes={[
        'Routing rules, default group, lighter path, no-material-change types (Manager).',
      ]}
    />
  )
}
