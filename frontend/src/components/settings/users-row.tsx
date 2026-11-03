import { MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PersonAvatar } from '@/components/materials/material-meta'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { formatDate, formatDateTime, formatRelativeTime } from '@/i18n/format'
import { cn } from '@/lib/utils'
import type { WorkspaceUser } from './user-data'
import type { UserDialogKind } from './users-action-dialog'
import { userColumns, type userActions } from './users-filters'
import { RolePill, UserStatusPill } from './users-meta'
import { useUserUpdate } from './users-update'

const col = userColumns

/** One person on one row: avatar, name and email, role, groups (or affiliate company), status, activity, and the Admin menu. */
export function UserRow({ user: u, actions, canEdit, onDialog }: {
  user: WorkspaceUser
  actions: ReturnType<typeof userActions>
  canEdit: boolean
  onDialog: (kind: UserDialogKind) => void
}) {
  const { t } = useTranslation()
  const off = u.status === 'deactivated'

  return (
    <div className={cn('flex h-12 items-center gap-3 px-3', off && 'text-muted-foreground')}>
      <span className={col.person}>
        <PersonAvatar name={u.name} className={cn('size-7 text-[11px]', off && 'bg-muted text-muted-foreground')} />
        <span className="grid min-w-0">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium">{u.name}</span>
            {actions.self && <span className="shrink-0 rounded-sm border px-1 text-[11px] text-muted-foreground">{t('settingsUsers.you')}</span>}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {u.email}
            {u.title && <span className="max-lg:hidden"> · {u.title}</span>}
          </span>
        </span>
      </span>

      <span className={col.role}><RolePill role={u.role} /></span>

      <span className={cn(col.groups, 'truncate text-xs')}>
        {u.role === 'affiliate' ? (
          <span className="flex min-w-0 items-center gap-1.5" title={t('settingsUsers.affiliateLine', { company: u.affiliate, manager: u.affiliateManager })}>
            <span className="shrink-0 rounded-sm border px-1 text-[11px] text-muted-foreground">{u.affiliate}</span>
            <span className="truncate text-muted-foreground">{t('settingsUsers.managedBy', { name: u.affiliateManager })}</span>
          </span>
        ) : u.groups.length ? (
          <span title={u.groups.join(', ')}>{u.groups.join(', ')}</span>
        ) : (
          <span className="text-muted-foreground">{t('settingsUsers.noGroups')}</span>
        )}
      </span>

      <span className={col.status}><UserStatusPill status={u.status} /></span>
      <span className={cn(col.activity, 'text-xs text-muted-foreground tabular-nums')}><Activity user={u} /></span>

      <span className={col.actions}>{canEdit && <UserMenu user={u} actions={actions} onDialog={onDialog} />}</span>
    </div>
  )
}

function Activity({ user: u }: { user: WorkspaceUser }) {
  const { t } = useTranslation()
  if (u.status === 'invited' && u.invitedAt) {
    return (
      <span title={t('settingsUsers.invitedBy', { name: u.invitedBy, date: formatDateTime(u.invitedAt) })}>
        {t('settingsUsers.invitedOn', { date: formatDate(u.invitedAt, { month: 'short', day: 'numeric' }) })}
      </span>
    )
  }
  if (!u.lastActiveAt) return <span>{t('settingsUsers.never')}</span>
  return <span title={formatDateTime(u.lastActiveAt)}>{formatRelativeTime(u.lastActiveAt)}</span>
}

function UserMenu({ user: u, actions: a, onDialog }: { user: WorkspaceUser; actions: ReturnType<typeof userActions>; onDialog: (kind: UserDialogKind) => void }) {
  const { t } = useTranslation()
  const update = useUserUpdate()
  const hasEdits = a.changeRole || a.changeGroups
  const hasStatus = a.resend || a.cancel || a.deactivate || a.reactivate
  if (!hasEdits && !hasStatus) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" aria-label={t('settingsUsers.actionsFor', { name: u.name })}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {a.changeRole && <DropdownMenuItem onSelect={() => onDialog('role')}>{t('settingsUsers.action.role')}</DropdownMenuItem>}
        {a.changeGroups && <DropdownMenuItem onSelect={() => onDialog('groups')}>{t('settingsUsers.action.groups')}</DropdownMenuItem>}
        {hasEdits && hasStatus && <DropdownMenuSeparator />}
        {a.resend && <DropdownMenuItem onSelect={() => update.resendInvite(u.id)}>{t('settingsUsers.action.resend')}</DropdownMenuItem>}
        {a.cancel && <DropdownMenuItem variant="destructive" onSelect={() => onDialog('cancel')}>{t('settingsUsers.action.cancel')}</DropdownMenuItem>}
        {a.reactivate && <DropdownMenuItem onSelect={() => update.setActive(u.id, true)}>{t('settingsUsers.action.reactivate')}</DropdownMenuItem>}
        {a.deactivate && <DropdownMenuItem variant="destructive" onSelect={() => onDialog('deactivate')}>{t('settingsUsers.action.deactivate')}</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
