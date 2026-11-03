import { useQueryClient } from '@tanstack/react-query'
import type { Role } from '@/components/review/material-detail-data'
import { demoViewer } from '@/components/review/material-detail-data'
import { uuidv7 } from '@/lib/uuid'
import type { WorkspaceUser } from './user-data'
import { nameFromEmail, nowIso, usesGroups } from './users-filters'

export type NewInvite = { emails: string[]; role: Role; groups: string[]; affiliate?: string; affiliateManager?: string }

/**
 * Admin changes to workspace users (PRD section 4, F16), in the demo cache.
 * TODO: replace with API calls. The server checks that the caller is an Admin, sends the invite emails,
 * ends the sessions of a deactivated user, and records every change in the audit log.
 */
export function useUserUpdate() {
  const queryClient = useQueryClient()
  const write = (change: (users: WorkspaceUser[]) => WorkspaceUser[]) =>
    queryClient.setQueryData<WorkspaceUser[]>(['users'], (users) => (users ? change(users) : users))
  const patch = (id: string, change: (u: WorkspaceUser) => WorkspaceUser) => write((users) => users.map((u) => (u.id === id ? change(u) : u)))

  return {
    /** One role per user. Below Reviewer, groups no longer apply, so they are removed. */
    setRole(id: string, role: Role) {
      patch(id, (u) => ({ ...u, role, groups: usesGroups(role) ? u.groups : [] }))
    },
    setGroups(id: string, groups: string[]) {
      patch(id, (u) => ({ ...u, groups }))
    },
    resendInvite(id: string) {
      patch(id, (u) => ({ ...u, invitedAt: nowIso(), invitedBy: demoViewer.name }))
    },
    /** An invite that nobody accepted leaves no history, so cancelling removes the person. */
    cancelInvite(id: string) {
      write((users) => users.filter((u) => u.id !== id))
    },
    /** Deactivated people cannot sign in. Their materials, decisions and audit history stay. */
    setActive(id: string, active: boolean) {
      patch(id, (u) => ({ ...u, status: active ? 'active' : 'deactivated' }))
    },
    invite(input: NewInvite) {
      const at = nowIso()
      const added: WorkspaceUser[] = input.emails.map((email) => ({
        id: uuidv7(),
        name: nameFromEmail(email),
        email,
        role: input.role,
        groups: usesGroups(input.role) ? input.groups : [],
        title: '',
        status: 'invited',
        invitedAt: at,
        invitedBy: demoViewer.name,
        ...(input.role === 'affiliate' ? { affiliate: input.affiliate, affiliateManager: input.affiliateManager } : {}),
      }))
      write((users) => [...users, ...added])
    },
  }
}
