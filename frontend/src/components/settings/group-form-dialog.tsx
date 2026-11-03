import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { nameTaken, useGroupUpdate, useReviewerGroups, type ReviewerGroup } from './group-data'

/** New groups start with the same review target as Compliance. */
const DEFAULT_TARGET = 2

/**
 * Create a reviewer group, or change one's name, description and review target (PRD F6, Managers only).
 * Members are added on the group's page, so this form stays short.
 */
export function GroupFormDialog({ group, open, onClose, onCreated }: {
  /** The group to edit. Leave it out to create a group. */
  group?: ReviewerGroup
  open: boolean
  onClose: () => void
  onCreated?: (id: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {/* Mounted only while open, so each time starts from the saved values. */}
        {open && <GroupForm group={group} onClose={onClose} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  )
}

function GroupForm({ group, onClose, onCreated }: { group?: ReviewerGroup; onClose: () => void; onCreated?: (id: string) => void }) {
  const { t } = useTranslation()
  const groups = useReviewerGroups()
  const update = useGroupUpdate()
  const [name, setName] = useState(group?.name ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  const [target, setTarget] = useState(String(group?.targetBusinessDays ?? DEFAULT_TARGET))

  const days = Number(target)
  const targetValid = Number.isInteger(days) && days >= 1 && days <= 30
  const taken = nameTaken(groups.data ?? [], name, group?.id)
  const ready = name.trim() && description.trim() && targetValid && !taken
  const renamed = group && name.trim() && name.trim() !== group.name

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready) return
        const input = { name: name.trim(), description: description.trim(), targetBusinessDays: days }
        if (group) update.edit(group.id, input)
        else onCreated?.(update.create(input))
        onClose()
      }}
    >
      <DialogHeader>
        <DialogTitle>{group ? t('settingsGroups.form.editTitle') : t('settingsGroups.form.createTitle')}</DialogTitle>
        <DialogDescription>{group ? t('settingsGroups.form.editDescription') : t('settingsGroups.form.createDescription')}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="group-name">{t('settingsGroups.form.name')}</Label>
        <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('settingsGroups.form.namePlaceholder')} aria-invalid={taken || undefined} autoFocus />
        {taken && <p className="text-xs text-destructive">{t('settingsGroups.form.nameTaken')}</p>}
        {renamed && !taken && <p className="text-xs text-muted-foreground">{t('settingsGroups.form.renameNote')}</p>}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="group-description">{t('settingsGroups.form.description')}</Label>
        <Textarea id="group-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder={t('settingsGroups.form.descriptionPlaceholder')} />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="group-target">{t('settingsGroups.form.target')}</Label>
        <div className="flex items-center gap-2">
          <Input id="group-target" type="number" inputMode="numeric" min={1} max={30} value={target} onChange={(e) => setTarget(e.target.value)} className="w-20 tabular-nums" aria-invalid={!targetValid || undefined} />
          <span className="text-sm text-muted-foreground">{t('settingsGroups.form.targetUnit')}</span>
        </div>
        <p className="text-xs text-muted-foreground">{t('settingsGroups.form.targetHint')}</p>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t('settingsGroups.cancel')}</Button>
        <Button type="submit" disabled={!ready}>{group ? t('settingsGroups.form.save') : t('settingsGroups.form.create')}</Button>
      </DialogFooter>
    </form>
  )
}
