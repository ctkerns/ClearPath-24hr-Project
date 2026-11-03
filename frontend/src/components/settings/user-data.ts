import { useQuery } from '@tanstack/react-query'
import type { Role } from '@/components/review/material-detail-data'

// Workspace users (PRD section 4, F16). The one shared list of people, roles and reviewer-group membership.
// Reviewer groups read their members from here, so a person's groups live in one place.
// TODO: replace USERS_URL with the real API (Admins only for changes; the server checks the role).
const USERS_URL = '/demo/users.json'

export type WorkspaceUser = {
  id: string
  name: string
  email: string
  role: Role
  /** Reviewer groups this person belongs to. Only Reviewers and higher roles approve for a group. */
  groups: string[]
  title: string
  status: 'active' | 'invited' | 'deactivated'
  lastActiveAt?: string
  invitedAt?: string
  invitedBy?: string
  /** Affiliates only: their company and its internal affiliate manager. */
  affiliate?: string
  affiliateManager?: string
}

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async (): Promise<WorkspaceUser[]> => {
      const res = await fetch(USERS_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()).users
    },
    // Demo changes live only in this cache (setQueryData), so never refetch over them. TODO: remove with the real API.
    staleTime: Infinity,
  })
}

/** Role order from PRD section 4. Each internal role has all the rights of the roles before it. */
export const ROLE_ORDER: Role[] = ['viewer', 'submitter', 'reviewer', 'manager', 'admin']

/** True when the role has at least the rights of `min`. Affiliates sit outside the hierarchy. */
export function hasRole(role: Role, min: Role) {
  if (role === 'affiliate') return min === 'affiliate'
  return ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(min)
}
