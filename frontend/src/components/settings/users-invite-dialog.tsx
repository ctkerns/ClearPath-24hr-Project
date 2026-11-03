import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Role } from '@/components/review/material-detail-data'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { hasRole, type WorkspaceUser } from './user-data'
import { useGroupNames } from './group-data'
import { parseInviteEmails, ROLES_BY_RANK, usesGroups } from './users-filters'
import { GroupChecklist } from './users-group-checklist'
import { useUserUpdate } from './users-update'

/** Invite people by email and give them one role (PRD F16). Admins only. */
export function InviteDialog({ users, open, onClose }: { users: WorkspaceUser[]; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {/* Mounted only while open, so each time starts from clean defaults. */}
        {open && <InviteForm users={users} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function InviteForm({ users, onClose }: { users: WorkspaceUser[]; onClose: () => void }) {
  const groupNames = useGroupNames()
  const { t } = useTranslation()
  const { invite } = useUserUpdate()
  const [text, setText] = useState('')
  const [role, setRole] = useState<Role>('submitter')
  const [groups, setGroups] = useState<string[]>([])
  const [company, setCompany] = useState('')
  // Each affiliate has one internal affiliate manager (PRD section 4): an active internal user who can submit.
  const managers = users.filter((u) => u.status === 'active' && u.role !== 'affiliate' && hasRole(u.role, 'submitter'))
  const [manager, setManager] = useState(() => managers.find((u) => u.title === 'Affiliate manager')?.name ?? managers[0]?.name ?? '')

  const emails = parseInviteEmails(text, users)
  const affiliate = role === 'affiliate'
  const ready = emails.valid.length > 0 && !emails.invalid.length && (!affiliate || (company.trim() && manager))

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready) return
        invite({ emails: emails.valid, role, groups, affiliate: company.trim(), affiliateManager: manager })
        onClose()
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('settingsUsers.invite.title')}</DialogTitle>
        <DialogDescription>{t('settingsUsers.invite.description')}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="invite-emails">{t('settingsUsers.invite.emailsLabel')}</Label>
        <Textarea
          id="invite-emails"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder={t('settingsUsers.invite.emailsPlaceholder')}
          aria-invalid={emails.invalid.length > 0 || undefined}
          aria-describedby="invite-emails-hint"
          autoFocus
        />
        <div id="invite-emails-hint" className="grid gap-0.5 text-xs text-muted-foreground">
          {emails.invalid.length > 0 ? (
            <p className="text-destructive">{t('settingsUsers.invite.invalid', { emails: emails.invalid.join(', ') })}</p>
          ) : (
            <p>{emails.valid.length ? t('settingsUsers.invite.count', { count: emails.valid.length }) : t('settingsUsers.invite.emailsHint')}</p>
          )}
          {emails.existing.length > 0 && <p>{t('settingsUsers.invite.existing', { emails: emails.existing.join(', ') })}</p>}
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="invite-role">{t('settingsUsers.field.role')}</Label>
        <Select value={role} onValueChange={(v) => setRole(v as Role)}>
          <SelectTrigger id="invite-role" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ROLES_BY_RANK.map((r) => <SelectItem key={r} value={r}>{t(`roles.${r}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t(`settingsUsers.roleAdds.${role}`)}</p>
      </div>

      {usesGroups(role) && (
        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">{t('settingsUsers.field.group')}</legend>
          <GroupChecklist groups={groupNames} value={groups} onChange={setGroups} idPrefix="invite-group" />
          <p className="text-xs text-muted-foreground">{t('settingsUsers.groupsHint')}</p>
        </fieldset>
      )}

      {affiliate && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="invite-company">{t('settingsUsers.invite.company')}</Label>
            <Input id="invite-company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder={t('settingsUsers.invite.companyPlaceholder')} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="invite-manager">{t('settingsUsers.affiliateManager')}</Label>
            <Select value={manager} onValueChange={setManager}>
              <SelectTrigger id="invite-manager" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {managers.map((u) => <SelectItem key={u.id} value={u.name}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">{t('settingsUsers.invite.affiliateHint')}</p>
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t('settingsUsers.cancel')}</Button>
        <Button type="submit" disabled={!ready}>
          {t('settingsUsers.invite.submit', { count: Math.max(emails.valid.length, 1) })}
        </Button>
      </DialogFooter>
    </form>
  )
}
