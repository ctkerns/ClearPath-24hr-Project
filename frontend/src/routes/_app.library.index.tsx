import { createFileRoute, redirect } from '@tanstack/react-router'

// /library opens its first tab.
export const Route = createFileRoute('/_app/library/')({
  beforeLoad: () => {
    throw redirect({ to: '/library/rules' })
  },
})
