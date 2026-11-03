import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderPage } from '@/components/placeholder-page'

export const Route = createFileRoute('/_app/settings/workspace')({
  component: WorkspaceTab,
})

function WorkspaceTab() {
  return (
    <PlaceholderPage
      screen="9"
      route="/settings/workspace"
      notes={[
        'Licensed states and demo reset (Admin).',
      ]}
    />
  )
}
