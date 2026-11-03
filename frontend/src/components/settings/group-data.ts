import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Material } from '@/components/materials/material-data'
import { useViewer } from '@/lib/session'
import { uuidv7 } from '@/lib/uuid'
import { hasRole, type WorkspaceUser } from './user-data'
import type { Role } from '@/components/review/material-detail-data'

// Reviewer groups (PRD section 4, F5, F6, screen 9). This file holds what a group is: name, description, review target.
// Who is in a group lives on each user (users.json, useUsers), so membership has one source of truth.
// TODO: replace GROUPS_URL with the real API (Managers and higher for changes; the server checks the role).
const GROUPS_URL = '/demo/reviewer-groups.json'

export type ReviewerGroup = {
  id: string
  name: string
  /** What the group reviews. */
  description: string
  /** Business days a review should take. The Dashboard uses the Compliance target. */
  targetBusinessDays: number
  /** New submissions go here when no routing rule matches. The Routing tab sets this. */
  isDefault: boolean
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
}

export function useReviewerGroups() {
  return useQuery({
    queryKey: ['reviewer-groups'],
    queryFn: async (): Promise<ReviewerGroup[]> => {
      const res = await fetch(GROUPS_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()).groups
    },
    // Demo changes live only in this cache (setQueryData), so never refetch over them. TODO: remove with the real API.
    staleTime: Infinity,
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
 * Demo changes to reviewer groups and their members, written to the query cache.
 * Membership changes go to the ['users'] cache, the one place it lives.
 * TODO: replace with API calls. A rename must also update routing rules and open reviews on the server.
 */
export function useGroupUpdate() {
  const viewer = useViewer()
  const queryClient = useQueryClient()
  const now = () => new Date().toISOString()

  const setGroups = (change: (list: ReviewerGroup[]) => ReviewerGroup[]) =>
    queryClient.setQueryData<ReviewerGroup[]>(['reviewer-groups'], (list = []) => change(list))
  const setUsers = (change: (u: WorkspaceUser) => WorkspaceUser) =>
    queryClient.setQueryData<WorkspaceUser[]>(['users'], (list) => list?.map(change))

  return {
    create(input: GroupInput) {
      const at = now()
      const group: ReviewerGroup = { id: uuidv7(), ...input, isDefault: false, createdBy: viewer.name, createdAt: at, updatedBy: viewer.name, updatedAt: at }
      setGroups((list) => [...list, group])
      return group.id
    },
    edit(id: string, input: GroupInput) {
      const old = queryClient.getQueryData<ReviewerGroup[]>(['reviewer-groups'])?.find((g) => g.id === id)
      setGroups((list) => list.map((g) => (g.id === id ? { ...g, ...input, updatedBy: viewer.name, updatedAt: now() } : g)))
      // Members keep their group after a rename.
      if (old && old.name !== input.name) {
        setUsers((u) => (u.groups.includes(old.name) ? { ...u, groups: u.groups.map((n) => (n === old.name ? input.name : n)) } : u))
      }
    },
    addMembers(groupName: string, userIds: string[]) {
      setUsers((u) => (userIds.includes(u.id) && !u.groups.includes(groupName) ? { ...u, groups: [...u.groups, groupName] } : u))
    },
    removeMember(groupName: string, userId: string) {
      setUsers((u) => (u.id === userId ? { ...u, groups: u.groups.filter((n) => n !== groupName) } : u))
    },
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
