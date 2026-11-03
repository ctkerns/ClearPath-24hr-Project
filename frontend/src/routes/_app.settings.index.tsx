import { createFileRoute, redirect } from '@tanstack/react-router'

// /settings opens its first tab.
export const Route = createFileRoute('/_app/settings/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/users' })
  },
})
