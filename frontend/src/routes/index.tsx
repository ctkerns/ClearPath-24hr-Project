import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSession } from '@/lib/session'

// "/" has no page of its own: the landing page is sign-in (PRD F1), or the Dashboard when signed in.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: getSession() ? '/dashboard' : '/sign-in' })
  },
})
