import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Role } from '@/components/review/material-detail-data'

// Workspace users (PRD section 4, F16). The one shared list of people, roles and reviewer-group membership.
// Reviewer groups read their members from here, so a person's groups live in one place.
// GET /api/users. Every internal role can read it; only Admins change it (the server checks the role).

export type WorkspaceUser = {
  id: string
  name: string
  email: string
  role: Role
  /** Reviewer groups this person belongs to. Only Reviewers and higher roles approve for a group. */
  groups: string[]
  title: string
  status: 'active' | 'invited' | 'deactivated'
  lastActiveAt?: string | null
  invitedAt?: string | null
  invitedBy?: string | null
  /** Affiliates only: their company and its internal affiliate manager (names). */
  affiliate?: string | null
  affiliateManager?: string | null
}

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => api<WorkspaceUser[]>('GET', '/users'),
  })
}

/** Role order from PRD section 4. Each internal role has all the rights of the roles before it. */
export const ROLE_ORDER: Role[] = ['viewer', 'submitter', 'reviewer', 'manager', 'admin']

/** True when the role has at least the rights of `min`. Affiliates sit outside the hierarchy. */
export function hasRole(role: Role, min: Role) {
  if (role === 'affiliate') return min === 'affiliate'
  return ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(min)
}
