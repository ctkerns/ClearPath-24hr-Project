import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Lock, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListFrame, ListHeader } from '@/components/list/list-frame'
import { applyFilters, withoutFilters, type ListSearch, isFiltered } from '@/components/list/list-filters'
import { ListToolbar } from '@/components/list/list-toolbar'
import { useViewer } from '@/lib/session'
import { useUsers } from '@/components/settings/user-data'
import { UserActionDialog, type UserDialogKind } from '@/components/settings/users-action-dialog'
import { sortUsers, userActions, userColumns as col, userSearchText, validateUsersSearch } from '@/components/settings/users-filters'
import { InviteDialog } from '@/components/settings/users-invite-dialog'
import { useUserList } from '@/components/settings/users-list-config'
import { RoleGuide } from '@/components/settings/users-role-guide'
import { UserRow } from '@/components/settings/users-row'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/_app/settings/users')({
  validateSearch: validateUsersSearch,
  component: UsersTab,
})

/**
 * Workspace users and their roles (PRD section 4, F16, screen 9). Only Admins change them; everyone else reads.
 * The server checks the role on every change; hiding the controls is only for clarity.
 */
function UsersTab() {
  const viewer = useViewer()
  const { t } = useTranslation()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const users = useUsers()
  const list = useUserList()
  const canEdit = viewer.role === 'admin'
  const [inviting, setInviting] = useState(false)
  const [dialog, setDialog] = useState<{ kind: UserDialogKind; id: string }>()

  const setSearch = (update: (prev: ListSearch) => ListSearch) => void navigate({ search: update, replace: true })

  const all = users.data ?? []
  const shown = sortUsers(applyFilters(all, search, list.fields, userSearchText), search)

  return (
    <div className="grid gap-4">
      <ListToolbar
        items={all}
        {...list}
        search={search}
        setSearch={setSearch}
        searchPlaceholder={t('settingsUsers.searchPlaceholder')}
        action={
          canEdit ? (
            <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setInviting(true)} disabled={!users.data}>
              <UserPlus className="size-3.5" />
              {t('settingsUsers.invite.open')}
            </Button>
          ) : undefined
        }
      />

      {!canEdit && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3.5" aria-hidden="true" />
          {t('settingsUsers.readOnly')}
        </p>
      )}

      <ListFrame
        query={users}
        filtered={isFiltered(search)}
        what={t('settingsUsers.what')}
        firstRun={{ text: t('settingsUsers.firstRun') }}
        isEmpty={shown.length === 0}
        emptyText={t('settingsUsers.empty')}
        onClear={() => setSearch((prev) => ({ sort: withoutFilters(prev).sort }))}
      >
        <ListHeader
          columns={[
            { label: t('settingsUsers.column.person'), className: col.person },
            { label: t('settingsUsers.column.role'), className: col.role },
            { label: t('settingsUsers.column.groups'), className: col.groups },
            { label: t('settingsUsers.column.status'), className: col.status },
            { label: t('settingsUsers.column.activity'), className: col.activity },
            { className: col.actions },
          ]}
        />
        <ul>
          {shown.map((u) => (
            <li key={u.id} className="border-b">
              <UserRow user={u} actions={userActions(u, viewer.name, all)} canEdit={canEdit} onDialog={(kind) => setDialog({ kind, id: u.id })} />
            </li>
          ))}
        </ul>
      </ListFrame>

      {users.data && <RoleGuide users={all} />}

      {canEdit && (
        <>
          <InviteDialog users={all} open={inviting} onClose={() => setInviting(false)} />
          <UserActionDialog kind={dialog?.kind} user={all.find((u) => u.id === dialog?.id)} onClose={() => setDialog(undefined)} />
        </>
      )}
    </div>
  )
}
