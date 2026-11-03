import { createFileRoute } from '@tanstack/react-router'

// /settings has no page of its own: the Settings layout sends it to the first tab this role can change.
export const Route = createFileRoute('/_app/settings/')({})
