import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Role } from '@/components/review/material-detail-data'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { ROLE_ORDER, type WorkspaceUser } from './user-data'
import { useGroupNames } from './group-data'
import { usesGroups } from './users-filters'
import { GroupChecklist } from './users-group-checklist'
import { RolePill } from './users-meta'
import { useUserUpdate } from './users-update'

export type UserDialogKind = 'role' | 'groups' | 'deactivate' | 'cancel'

/** One dialog for the per-user changes that need a choice or a confirmation. */
export function UserActionDialog({ kind, user, onClose }: {
  kind?: UserDialogKind
  user?: WorkspaceUser
  onClose: () => void
}) {
  const open = Boolean(kind && user)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {kind === 'role' && user && <RoleForm user={user} onClose={onClose} />}
        {kind === 'groups' && user && <GroupsForm user={user} onClose={onClose} />}
        {(kind === 'deactivate' || kind === 'cancel') && user && <ConfirmForm kind={kind} user={user} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function RoleForm({ user, onClose }: { user: WorkspaceUser; onClose: () => void }) {
  const { t } = useTranslation()
  const { setRole } = useUserUpdate()
  const [role, setValue] = useState<Role>(user.role)
  const losesGroups = !usesGroups(role) && user.groups.length > 0
  const needsGroups = usesGroups(role) && !usesGroups(user.role)

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        setRole(user.id, role)
        onClose()
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('settingsUsers.roleDialog.title', { name: user.name })}</DialogTitle>
        <DialogDescription>{t('settingsUsers.roleDialog.description')}</DialogDescription>
      </DialogHeader>

      {/* Highest role first. Each one names only what it adds to the role below it. */}
      <div role="radiogroup" aria-label={t('settingsUsers.field.role')} className="grid overflow-hidden rounded-md border">
        {[...ROLE_ORDER].reverse().map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={role === r}
            onClick={() => setValue(r)}
            className={cn(
              'grid gap-1 border-b px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/60',
              'aria-checked:bg-primary-soft aria-checked:shadow-[inset_3px_0_0_var(--color-primary)]',
            )}
          >
            <span className="flex items-center gap-2">
              <RolePill role={r} />
              {r === user.role && <span className="text-xs text-muted-foreground">{t('settingsUsers.roleDialog.current')}</span>}
            </span>
            <span className="text-xs text-muted-foreground">{t(`settingsUsers.roleAdds.${r}`)}</span>
          </button>
        ))}
      </div>

      {losesGroups && <p className="text-xs text-risk-medium">{t('settingsUsers.roleDialog.losesGroups', { name: user.name, groups: user.groups.join(', ') })}</p>}
      {needsGroups && <p className="text-xs text-muted-foreground">{t('settingsUsers.roleDialog.needsGroups')}</p>}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t('settingsUsers.cancel')}</Button>
        <Button type="submit" disabled={role === user.role}>{t('settingsUsers.roleDialog.submit')}</Button>
      </DialogFooter>
    </form>
  )
}

function GroupsForm({ user, onClose }: { user: WorkspaceUser; onClose: () => void }) {
  const groupNames = useGroupNames()
  const { t } = useTranslation()
  const { setGroups } = useUserUpdate()
  const [groups, setValue] = useState(user.groups)
  const same = groups.length === user.groups.length && groups.every((g) => user.groups.includes(g))

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        setGroups(user.id, groups)
        onClose()
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('settingsUsers.groupsDialog.title', { name: user.name })}</DialogTitle>
        <DialogDescription>{t('settingsUsers.groupsHint')}</DialogDescription>
      </DialogHeader>
      <GroupChecklist groups={groupNames} value={groups} onChange={setValue} idPrefix="user-group" />
      {!groups.length && <p className="text-xs text-risk-medium">{t('settingsUsers.groupsDialog.none', { name: user.name })}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t('settingsUsers.cancel')}</Button>
        <Button type="submit" disabled={same}>{t('settingsUsers.groupsDialog.submit')}</Button>
      </DialogFooter>
    </form>
  )
}

function ConfirmForm({ kind, user, onClose }: { kind: 'deactivate' | 'cancel'; user: WorkspaceUser; onClose: () => void }) {
  const { t } = useTranslation()
  const { setActive, cancelInvite } = useUserUpdate()
  const key = kind === 'deactivate' ? 'deactivateDialog' : 'cancelDialog'

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (kind === 'deactivate') setActive(user.id, false)
        else cancelInvite(user.id)
        onClose()
      }}
    >
      <DialogHeader>
        <DialogTitle>{t(`settingsUsers.${key}.title`, { name: user.name })}</DialogTitle>
        <DialogDescription>{t(`settingsUsers.${key}.description`, { name: user.name, email: user.email })}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t('settingsUsers.keep')}</Button>
        <Button type="submit" variant="destructive">{t(`settingsUsers.${key}.submit`)}</Button>
      </DialogFooter>
    </form>
  )
}
