import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderPage } from '@/components/placeholder-page'

export const Route = createFileRoute('/_app/settings/reviewer-groups')({
  component: ReviewerGroupsTab,
})

function ReviewerGroupsTab() {
  return (
    <PlaceholderPage
      screen="9"
      route="/settings/reviewer-groups"
      notes={[
        'Reviewer groups and their members (Manager).',
      ]}
    />
  )
}
