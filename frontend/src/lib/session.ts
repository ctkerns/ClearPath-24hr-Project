import { getRouteApi } from '@tanstack/react-router'
import { queryOptions } from '@tanstack/react-query'
import type { Role } from '@/components/review/material-detail-data'

// Sign-in and the session (PRD F1). The server checks the password, keeps the session, and sets an
// httpOnly cookie that JavaScript cannot read. The browser only asks the server who is signed in.

/** The signed-in user. Comes from GET /api/auth/me. */
export type SessionUser = {
  id: string
  name: string
  email: string
  title: string | null
  role: Role
  workspaceId: string
  isDemo: boolean
  /** Names of the reviewer groups this user approves for (PRD F6). */
  groups: string[]
}

/** A row of the "Try the demo" panel on the sign-in page. */
export type DemoAccount = { name: string; email: string; role: Role; title: string; affiliate?: string }

/** The shared password of every demo account. The sign-in page shows it, as PRD F1 asks. */
export const DEMO_PASSWORD = 'clearpath-demo'

/** One seeded account per role (PRD F1), in the role order of PRD section 4. backend/src/app/seed_data has the same users. */
export const DEMO_ACCOUNTS: DemoAccount[] = [
  { name: 'Ben Okafor', email: 'ben.okafor@demo.clearpathcu.org', role: 'viewer', title: 'Internal audit' },
  { name: 'Priya Shah', email: 'priya.shah@demo.clearpathcu.org', role: 'submitter', title: 'Marketing' },
  { name: 'Jordan Kim', email: 'jordan.kim@demo.clearpathcu.org', role: 'reviewer', title: 'Compliance analyst' },
  { name: 'Alex Chen', email: 'alex.chen@demo.clearpathcu.org', role: 'manager', title: 'Compliance manager' },
  { name: 'Maya Ruiz', email: 'maya.ruiz@demo.clearpathcu.org', role: 'admin', title: 'Compliance operations' },
  { name: 'Erin Walsh', email: 'erin.walsh@lendwise.example', role: 'affiliate', title: 'Partner marketing', affiliate: 'LendWise' },
]

/**
 * Who is signed in, or null. Route guards load it with queryClient.ensureQueryData(sessionQuery).
 * Sign-in and sign-out reload the page, so the cached value never goes out of date.
 */
export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: async (): Promise<SessionUser | null> => {
    const res = await fetch('/api/auth/me')
    if (res.status === 401) return null
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as SessionUser
  },
  staleTime: Infinity,
  retry: false,
})

const appRoute = getRouteApi('/_app')

/**
 * The signed-in user. Use it in any component or hook under the _app layout:
 * its beforeLoad signs-in-or-redirects first, so the user is always there.
 */
export function useViewer(): SessionUser {
  return appRoute.useRouteContext({ select: (c) => c.viewer })
}

/** Rejects with 'invalid_credentials' for every wrong email or password, so the page never says whether the email exists. */
export async function signIn(email: string, password: string): Promise<void> {
  const res = await fetch('/api/auth/sign-in', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (res.status === 401 || res.status === 422) throw new Error('invalid_credentials')
  if (!res.ok) throw new Error('unavailable')
}

/** Ends the session on the server. The caller then reloads the page. */
export async function signOut(): Promise<void> {
  await fetch('/api/auth/sign-out', { method: 'POST' }).catch(() => undefined)
}

/** Only paths inside the app, so a link cannot send someone to another site after sign-in. */
export function safeRedirect(path: unknown) {
  return typeof path === 'string' && /^\/(?![/\\])/.test(path) && !path.startsWith('/sign-in') ? path : '/dashboard'
}
