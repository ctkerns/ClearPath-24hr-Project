import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PersonAvatar } from '@/components/materials/material-meta'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { canJoinGroup, useGroupUpdate } from './group-data'
import { useUsers } from './user-data'

/**
 * Add people to a reviewer group. Only Reviewers and higher roles are listed, because members approve
 * for the group (PRD F6). Someone with a lower role needs a role change in Users first.
 */
export function GroupMembersDialog({ groupName, open, onClose }: { groupName: string; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {open && <MembersForm groupName={groupName} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function MembersForm({ groupName, onClose }: { groupName: string; onClose: () => void }) {
  const { t } = useTranslation()
  const users = useUsers()
  const update = useGroupUpdate()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string[]>([])

  const candidates = (users.data ?? []).filter((u) => canJoinGroup(u) && !u.groups.includes(groupName))
  const q = query.trim().toLowerCase()
  const shown = q ? candidates.filter((u) => `${u.name} ${u.email} ${u.title}`.toLowerCase().includes(q)) : candidates

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!picked.length) return
        update.addMembers(groupName, picked)
        onClose()
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('settingsGroups.add.title', { group: groupName })}</DialogTitle>
        <DialogDescription>{t('settingsGroups.add.description')}</DialogDescription>
      </DialogHeader>

      {candidates.length === 0 ? (
        <p className="rounded-md border bg-muted/40 px-3 py-4 text-center text-muted-foreground">{t('settingsGroups.add.none')}</p>
      ) : (
        <div className="grid gap-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('settingsGroups.add.search')} aria-label={t('settingsGroups.add.search')} />
          <ul className="max-h-72 overflow-y-auto rounded-md border">
            {shown.map((u) => {
              const id = `add-member-${u.id}`
              return (
                <li key={u.id} className="border-b last:border-b-0">
                  <label htmlFor={id} className="flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/60">
                    <Checkbox
                      id={id}
                      checked={picked.includes(u.id)}
                      onCheckedChange={(on) => setPicked((p) => (on ? [...p, u.id] : p.filter((x) => x !== u.id)))}
                    />
                    <PersonAvatar name={u.name} className="size-6 text-[10px]" />
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate font-medium">{u.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{u.title} · {t(`roles.${u.role}`)}</span>
                    </span>
                    {u.status === 'invited' && <span className="text-xs text-muted-foreground">{t('settingsGroups.invited')}</span>}
                  </label>
                </li>
              )
            })}
            {shown.length === 0 && <li className="px-3 py-4 text-center text-muted-foreground">{t('settingsGroups.add.noMatch')}</li>}
          </ul>
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t('settingsGroups.cancel')}</Button>
        <Button type="submit" disabled={!picked.length}>{picked.length ? t('settingsGroups.add.submit', { count: picked.length }) : t('settingsGroups.members.add')}</Button>
      </DialogFooter>
    </form>
  )
}
