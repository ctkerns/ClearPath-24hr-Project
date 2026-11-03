import { ShieldCheck, UsersRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FilterField, Preset, SortOption } from '@/components/list/list-filters'
import { StatusFieldIcon } from '@/components/materials/material-meta'
import type { Role } from '@/components/review/material-detail-data'
import { useGroupNames } from './group-data'
import type { WorkspaceUser } from './user-data'
import { allGroups, ROLES_BY_RANK, USER_FILTER_KEYS, USER_PRESETS, USER_SORTS, USER_STATUSES, userValues, type UserFilterKey } from './users-filters'
import { RolePill, UserStatusPill } from './users-meta'

const icons = { role: ShieldCheck, group: UsersRound, status: StatusFieldIcon } satisfies Record<UserFilterKey, unknown>

/** Fields, quick views and sorts for the Users list, with their translated labels. */
export function useUserList() {
  const { t } = useTranslation()
  const groupNames = useGroupNames()

  const label = (key: UserFilterKey, v: string): string => {
    switch (key) {
      case 'role': return t(`roles.${v as Role}`)
      case 'group': return v
      case 'status': return t(`settingsUsers.status.${v as WorkspaceUser['status']}`)
    }
  }
  const options: Record<UserFilterKey, (items: WorkspaceUser[]) => string[]> = {
    role: () => ROLES_BY_RANK,
    group: (items) => allGroups(groupNames, items),
    status: () => [...USER_STATUSES],
  }
  const render: Partial<Record<UserFilterKey, (v: string) => React.ReactNode>> = {
    role: (v) => <RolePill role={v as Role} />,
    status: (v) => <UserStatusPill status={v as WorkspaceUser['status']} />,
  }

  const fields: FilterField<WorkspaceUser>[] = USER_FILTER_KEYS.map((key) => ({
    key,
    label: t(`settingsUsers.field.${key}`),
    icon: icons[key],
    values: (u) => userValues(u, key),
    options: options[key],
    optionLabel: (v) => label(key, v),
    renderOption: render[key],
  }))
  const presets: Preset[] = USER_PRESETS.map((p) => ({ key: p.key, label: t(`settingsUsers.preset.${p.key}`), filters: p.filters }))
  const sorts: SortOption[] = USER_SORTS.map((key) => ({ key, label: t(`settingsUsers.sort.${key}`) }))
  return { fields, presets, sorts, defaultSort: 'name' }
}
