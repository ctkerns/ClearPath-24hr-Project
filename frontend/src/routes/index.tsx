import { createFileRoute, redirect } from '@tanstack/react-router'
import { sessionQuery } from '@/lib/session'

// "/" has no page of its own: the landing page is sign-in (PRD F1), or the Dashboard when signed in.
export const Route = createFileRoute('/')({
  beforeLoad: async ({ context }) => {
    const viewer = await context.queryClient.ensureQueryData(sessionQuery).catch(() => null)
    throw redirect({ to: viewer ? '/dashboard' : '/sign-in' })
  },
})
