import { validateListSearch, type ListSearch } from '@/components/list/list-filters'
import type { Role } from '@/components/review/material-detail-data'
import { hasRole, ROLE_ORDER, type WorkspaceUser } from './user-data'

// Users list configuration: filter keys, sorts, quick views and small helpers. Labels and menus are in users-list-config.tsx.

export const USER_FILTER_KEYS = ['role', 'group', 'status'] as const
export type UserFilterKey = (typeof USER_FILTER_KEYS)[number]

export const USER_SORTS = ['name', 'role', 'lastActive'] as const
export type UserSort = (typeof USER_SORTS)[number]

export const USER_STATUSES = ['active', 'invited', 'deactivated'] as const satisfies readonly WorkspaceUser['status'][]

/** Internal roles from highest to lowest, then affiliates. The order of the role filter and the role sort. */
export const ROLES_BY_RANK: Role[] = [...[...ROLE_ORDER].reverse(), 'affiliate']

export const validateUsersSearch = (raw: Record<string, unknown>) => validateListSearch(raw, USER_FILTER_KEYS, USER_SORTS)

export function userValues(u: WorkspaceUser, key: UserFilterKey): string[] {
  switch (key) {
    case 'role': return [u.role]
    case 'group': return u.groups
    case 'status': return [u.status]
  }
}

export const userSearchText = (u: WorkspaceUser) => [u.name, u.email, u.title, u.affiliate, u.affiliateManager, ...u.groups]

/** The date that the last-active column shows: when they last signed in, or when they were invited. */
const activityDate = (u: WorkspaceUser) => u.lastActiveAt ?? u.invitedAt ?? ''

export function sortUsers(users: WorkspaceUser[], search: ListSearch) {
  const list = [...users]
  switch ((search.sort ?? 'name') as UserSort) {
    case 'name': return list.sort((a, b) => a.name.localeCompare(b.name))
    case 'role': return list.sort((a, b) => ROLES_BY_RANK.indexOf(a.role) - ROLES_BY_RANK.indexOf(b.role) || a.name.localeCompare(b.name))
    case 'lastActive': return list.sort((a, b) => activityDate(b).localeCompare(activityDate(a)))
  }
}

export const USER_PRESETS = [
  { key: 'all', filters: {} },
  { key: 'active', filters: { status: 'active' } },
  { key: 'invited', filters: { status: 'invited' } },
  { key: 'deactivated', filters: { status: 'deactivated' } },
] as const

/** Reviewer groups only count for Reviewers and higher roles (PRD section 4). */
export const usesGroups = (role: Role) => role !== 'affiliate' && hasRole(role, 'reviewer')

/** Active Admins. The workspace must always keep one, so the last one cannot lose the role or be deactivated. */
export const activeAdmins = (users: WorkspaceUser[]) => users.filter((u) => u.role === 'admin' && u.status === 'active')

/** What the signed-in Admin may do to one user. Nobody changes their own role or deactivates themselves. */
export function userActions(u: WorkspaceUser, viewerName: string, users: WorkspaceUser[]) {
  const self = u.name === viewerName
  const lastAdmin = u.role === 'admin' && u.status === 'active' && activeAdmins(users).length <= 1
  const live = u.status !== 'deactivated'
  return {
    self,
    // An affiliate stays an affiliate: an external partner never becomes internal staff by a role change.
    changeRole: live && !self && !lastAdmin && u.role !== 'affiliate',
    changeGroups: live && usesGroups(u.role),
    resend: u.status === 'invited',
    cancel: u.status === 'invited',
    deactivate: u.status === 'active' && !self && !lastAdmin,
    reactivate: u.status === 'deactivated',
  }
}

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

/** Splits pasted text into addresses (commas, semicolons, spaces or new lines) and sorts out the bad and the taken ones. */
export function parseInviteEmails(text: string, users: WorkspaceUser[]) {
  const taken = new Set(users.map((u) => u.email.toLowerCase()))
  const all = [...new Set(text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))]
  return {
    valid: all.filter((e) => EMAIL.test(e) && !taken.has(e)),
    invalid: all.filter((e) => !EMAIL.test(e)),
    existing: all.filter((e) => EMAIL.test(e) && taken.has(e)),
  }
}

/** A display name until the person accepts and sets their own: "nina.patel@x.org" → "Nina Patel". */
export function nameFromEmail(email: string) {
  return email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ')
}

/** The current time as an ISO string, for demo writes. */
export const nowIso = () => new Date().toISOString()

/** All reviewer groups: the Reviewer groups tab's list (useGroupNames), plus any that only appear on a user. */
export const allGroups = (groupNames: string[], users: WorkspaceUser[]) =>
  [...new Set([...groupNames, ...users.flatMap((u) => u.groups)])].sort((a, b) => a.localeCompare(b))

/** Column widths and breakpoints, shared by the header row and every user row so they line up. */
export const userColumns = {
  person: 'flex min-w-0 flex-1 items-center gap-2.5',
  role: 'w-24 shrink-0',
  groups: 'w-52 shrink-0 max-md:hidden',
  status: 'w-24 shrink-0 max-sm:hidden',
  activity: 'w-28 shrink-0 text-right max-lg:hidden',
  actions: 'flex w-7 shrink-0 justify-end',
}
