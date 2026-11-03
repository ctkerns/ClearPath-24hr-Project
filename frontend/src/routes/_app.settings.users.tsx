import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderPage } from '@/components/placeholder-page'

export const Route = createFileRoute('/_app/settings/users')({
  component: UsersTab,
})

function UsersTab() {
  return (
    <PlaceholderPage
      screen="9"
      route="/settings/users"
      notes={[
        'Users and roles, invites (Admin).',
      ]}
    />
  )
}
