import { useQueryClient } from '@tanstack/react-query'
import type { Role } from '@/components/review/material-detail-data'
import { api } from '@/lib/api'

export type NewInvite = { emails: string[]; role: Role; groups: string[]; affiliate?: string; affiliateManagerId?: string }

/**
 * Admin changes to workspace users (PRD section 4, F16). Each one calls the API, then reloads the user list.
 * The server checks that the caller is an Admin, ends the sessions of a deactivated user,
 * and removes the groups of a user whose role goes below Reviewer.
 * The server emails the invite links (F16). TODO: it records every change in the audit log.
 * Each function returns a promise that rejects with an ApiError, so a dialog can show what went wrong.
 */
export function useUserUpdate() {
  const queryClient = useQueryClient()
  const after = <T,>(call: Promise<T>) =>
    call.then(async (result) => {
      // Groups show members, so both lists change together.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['users'] }),
        queryClient.invalidateQueries({ queryKey: ['reviewer-groups'] }),
      ])
      return result
    })

  return {
    /** One role per user. Below Reviewer, the server removes the groups. */
    setRole: (id: string, role: Role) => after(api('PATCH', `/users/${id}`, { role })),
    setGroups: (id: string, groups: string[]) => after(api('PUT', `/users/${id}/groups`, { groups })),
    resendInvite: (id: string) => after(api('POST', `/users/${id}/resend-invite`)),
    /** An invite that nobody accepted leaves no history, so cancelling removes the person. */
    cancelInvite: (id: string) => after(api('DELETE', `/users/${id}`)),
    /** Deactivated people cannot sign in. Their materials, decisions and audit history stay. */
    setActive: (id: string, active: boolean) => after(api('PATCH', `/users/${id}`, { status: active ? 'active' : 'deactivated' })),
    invite: (input: NewInvite) => after(api('POST', '/users/invites', input)),
  }
}
