import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderPage } from '@/components/placeholder-page'

export const Route = createFileRoute('/_app/settings/integrations')({
  component: IntegrationsTab,
})

function IntegrationsTab() {
  return (
    <PlaceholderPage
      screen="9"
      route="/settings/integrations"
      notes={[
        'Each connector: connection status, Verified or Unverified, last sync, Sync now (Admin, F11).',
      ]}
    />
  )
}
