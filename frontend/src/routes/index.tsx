import { createFileRoute, redirect } from '@tanstack/react-router'

// "/" has no page of its own. Later: go to /sign-in when there is no session.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/dashboard' })
  },
})
