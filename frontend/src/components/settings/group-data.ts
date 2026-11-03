import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Material } from '@/components/materials/material-data'
import { api } from '@/lib/api'
import { hasRole, type WorkspaceUser } from './user-data'
import type { Role } from '@/components/review/material-detail-data'

// Reviewer groups (PRD section 4, F5, F6, screen 9). This file holds what a group is: name, description, review target.
// Who is in a group shows on each user (useUsers). GET /api/reviewer-groups; Managers and higher change them.

export type ReviewerGroup = {
  id: string
  name: string
  /** What the group reviews. */
  description: string
  /** Business days a review should take. The Dashboard uses the Compliance target. */
  targetBusinessDays: number
  /** New submissions go here when no routing rule matches. The Routing tab sets this. */
  isDefault: boolean
  createdBy: string | null
  createdAt: string
  updatedBy: string | null
  updatedAt: string
}

export function useReviewerGroups() {
  return useQuery({
    queryKey: ['reviewer-groups'],
    queryFn: () => api<ReviewerGroup[]>('GET', '/reviewer-groups'),
  })
}

/** Only Managers and higher change reviewer groups. */
export const canManageGroups = (role: Role) => hasRole(role, 'manager')

/** Only Reviewers and higher can be group members, because members approve for the group (PRD F6). */
export const canJoinGroup = (u: WorkspaceUser) => u.status !== 'deactivated' && hasRole(u.role, 'reviewer')

export const membersOf = (users: WorkspaceUser[], groupName: string) => users.filter((u) => u.groups.includes(groupName))

/** Items waiting on this group now: submitted or in review, and the group has not decided yet. */
export function queueOf(materials: Material[], groupName: string) {
  return materials.filter(
    (m) => (m.status === 'submitted' || m.status === 'in_review') && m.groups.some((g) => g.name === groupName && g.state === 'waiting'),
  )
}

export type GroupInput = { name: string; description: string; targetBusinessDays: number }

/**
 * Manager changes to reviewer groups and their members. Each one calls the API, then reloads the lists.
 * Membership refers to the group id on the server, so a rename keeps the members.
 * Each function returns a promise that rejects with an ApiError, so a dialog can show what went wrong.
 */
export function useGroupUpdate() {
  const queryClient = useQueryClient()
  const groupId = (name: string) => queryClient.getQueryData<ReviewerGroup[]>(['reviewer-groups'])?.find((g) => g.name === name)?.id
  const after = <T,>(call: Promise<T>) =>
    call.then(async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reviewer-groups'] }),
        queryClient.invalidateQueries({ queryKey: ['users'] }),
      ])
      return result
    })

  return {
    /** Resolves with the new group's id. */
    create: (input: GroupInput) => after(api<ReviewerGroup>('POST', '/reviewer-groups', input)).then((g) => g.id),
    edit: (id: string, input: GroupInput) => after(api('PATCH', `/reviewer-groups/${id}`, input)),
    addMembers: (groupName: string, userIds: string[]) => after(api('POST', `/reviewer-groups/${groupId(groupName)}/members`, { userIds })),
    removeMember: (groupName: string, userId: string) => after(api('DELETE', `/reviewer-groups/${groupId(groupName)}/members/${userId}`)),
  }
}

/** True when another group already uses this name (case does not matter). */
export function nameTaken(groups: ReviewerGroup[], name: string, exceptId?: string) {
  const n = name.trim().toLowerCase()
  return groups.some((g) => g.id !== exceptId && g.name.toLowerCase() === n)
}

/** Group names for pickers, from the Reviewer groups tab, so a new or renamed group shows everywhere at once. */
export function useGroupNames() {
  const groups = useReviewerGroups()
  return (groups.data ?? []).map((g) => g.name).sort((a, b) => a.localeCompare(b))
}
