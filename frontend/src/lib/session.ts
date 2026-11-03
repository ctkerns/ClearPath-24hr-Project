import type { Role } from '@/components/review/material-detail-data'

// Sign-in and the session (PRD F1).
// TODO: replace with the real auth API. The server checks the hashed password, sets a secure, httpOnly session
// cookie, and checks the role on every request. This demo stand-in checks the demo accounts in the browser
// and keeps the signed-in user in localStorage, so it is NOT security: it only lets the screens act as each role.

export type SessionUser = { name: string; email: string; role: Role; groups: string[]; title: string; affiliate?: string }

/** The shared password of every demo account. The sign-in page shows it, as PRD F1 asks. */
export const DEMO_PASSWORD = 'clearpath-demo'

/** One seeded account per role (PRD F1), in the role order of PRD section 4. The names match the demo data. */
export const DEMO_ACCOUNTS: SessionUser[] = [
  { name: 'Ben Okafor', email: 'ben.okafor@demo.clearpathcu.org', role: 'viewer', groups: [], title: 'Internal audit' },
  { name: 'Priya Shah', email: 'priya.shah@demo.clearpathcu.org', role: 'submitter', groups: [], title: 'Marketing' },
  { name: 'Jordan Kim', email: 'jordan.kim@demo.clearpathcu.org', role: 'reviewer', groups: ['Compliance'], title: 'Compliance analyst' },
  { name: 'Alex Chen', email: 'alex.chen@demo.clearpathcu.org', role: 'manager', groups: ['Compliance', 'Senior compliance'], title: 'Compliance manager' },
  { name: 'Maya Ruiz', email: 'maya.ruiz@demo.clearpathcu.org', role: 'admin', groups: ['Compliance'], title: 'Compliance operations' },
  { name: 'Erin Walsh', email: 'erin.walsh@lendwise.example', role: 'affiliate', groups: [], title: 'Partner marketing', affiliate: 'LendWise' },
]

const KEY = 'clearpath.session'

export function getSession(): SessionUser | undefined {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as SessionUser) : undefined
  } catch {
    return undefined
  }
}

/**
 * Checks the email and password. It rejects with one message for every failure,
 * so the page never says whether the email exists.
 */
export async function signIn(email: string, password: string): Promise<SessionUser> {
  await new Promise((resolve) => setTimeout(resolve, 450)) // Stand-in for the network round trip.
  const user = DEMO_ACCOUNTS.find((a) => a.email.toLowerCase() === email.trim().toLowerCase())
  if (!user || password !== DEMO_PASSWORD) throw new Error('invalid_credentials')
  // Role and reviewer groups come from the workspace users list (Settings > Users), not from the account list above.
  const users: { email: string; role: Role; groups: string[]; status: string }[] = await fetch('/demo/users.json')
    .then((res) => (res.ok ? res.json() : { users: [] }))
    .then((json) => json.users)
    .catch(() => [])
  const record = users.find((u) => u.email.toLowerCase() === user.email.toLowerCase())
  if (record?.status === 'deactivated') throw new Error('invalid_credentials')
  const session = record ? { ...user, role: record.role, groups: record.groups } : user
  try {
    localStorage.setItem(KEY, JSON.stringify(session))
  } catch {
    throw new Error('storage_blocked')
  }
  return session
}

export function signOut() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing stored, so nothing to remove.
  }
}

/** Only paths inside the app, so a link cannot send someone to another site after sign-in. */
export function safeRedirect(path: unknown) {
  return typeof path === 'string' && /^\/(?![/\\])/.test(path) && !path.startsWith('/sign-in') ? path : '/dashboard'
}
