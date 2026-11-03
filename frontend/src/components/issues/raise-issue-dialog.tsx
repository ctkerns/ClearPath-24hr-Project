import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Material } from '@/components/materials/material-data'
import { useOptionLabel } from '@/components/materials/use-option-label'
import { useViewer } from '@/lib/session'
import { useSave } from '@/lib/use-save'
import { SaveError } from '@/components/save-error'
import { Checkbox } from '@/components/ui/checkbox'
import { useUsers } from '@/components/settings/user-data'
import { useIssueDueDays } from '@/components/settings/workspace-data'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SeverityLabel, type RiskLevel } from '@/components/ui/risk-tag'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ISSUE_KINDS, SEVERITIES, type IssueKind } from './issue-data'
import { useRaiseIssue } from './issue-update'

/** A date as yyyy-mm-dd, some days from today, for the date field. */
function dateFromToday(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('en-CA')
}

/**
 * Raise an issue on a material (PRD F12). Any Reviewer or higher can do this at any time,
 * for example when they disagree with an approval or see a problem that monitoring missed.
 * The owner is the material owner by default.
 */
export function RaiseIssueDialog({ material, open, onClose }: {
  material: Material
  open: boolean
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {/* Mounted only while open, so each time starts from clean defaults. */}
        {open && <RaiseIssueForm material={material} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function RaiseIssueForm({ material, onClose }: { material: Material; onClose: () => void }) {
  const viewer = useViewer()
  const users = useUsers()
  const { pending, error, run } = useSave(() => undefined)
  const { t } = useTranslation()
  const raise = useRaiseIssue()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [severity, setSeverity] = useState<RiskLevel>('medium')
  const [kind, setKind] = useState<IssueKind | 'none'>('none')
  const [presentAtApproval, setPresentAtApproval] = useState(false)
  const label = useOptionLabel()
  // Active people can own it: internal users, and the affiliates of this material's company (PRD R4).
  const people = (users.data ?? []).filter(
    (u) => u.status === 'active' && (u.role !== 'affiliate' || (!!material.affiliate && u.affiliate === material.affiliate)),
  )
  const [ownerId, setOwnerId] = useState<string>()
  const owner = ownerId ?? people.find((u) => u.name === material.owner)?.id ?? viewer.id
  // The due date follows the severity, by the workspace's defaults (Settings, Issues tab), until the person picks a date.
  const daysToFix = useIssueDueDays()
  const [pickedDue, setPickedDue] = useState<string>()
  const dueDate = pickedDue ?? (daysToFix ? dateFromToday(daysToFix[severity]) : '')
  const ready = title.trim() && summary.trim() && dueDate && users.data

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready) return
        void run(async () => {
          const id = await raise(material.id, {
            title: title.trim(),
            summary: summary.trim(),
            severity,
            ownerId: owner,
            dueDate,
            kind: kind === 'none' ? undefined : kind,
            presentAtApproval: !!material.approvalId && presentAtApproval,
          })
          onClose()
          void navigate({ to: '/issues/$issueId', params: { issueId: id } })
        })
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('issue.raise.title')}</DialogTitle>
        <DialogDescription>{t('issue.raise.description', { material: material.title })}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="issue-title">{t('issue.raise.titleLabel')}</Label>
        <Input id="issue-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('issue.raise.titlePlaceholder')} autoFocus />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="issue-summary">{t('issue.raise.summaryLabel')}</Label>
        <Textarea id="issue-summary" value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} placeholder={t('issue.raise.summaryPlaceholder')} />
      </div>

      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">{t('issues.field.severity')}</legend>
        <div role="radiogroup" className="flex gap-2">
          {SEVERITIES.map((level) => (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={severity === level}
              onClick={() => setSeverity(level)}
              className={cn(
                'flex h-8 flex-1 items-center justify-center rounded-md border transition-colors hover:bg-muted',
                'aria-checked:border-primary aria-checked:bg-primary-soft aria-checked:shadow-[inset_0_0_0_1px_var(--color-primary)]',
              )}
            >
              <SeverityLabel level={level} />
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="issue-owner">{t('issues.field.owner')}</Label>
          <Select value={owner} onValueChange={setOwnerId}>
            <SelectTrigger id="issue-owner" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {people.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                  {u.name === material.owner && <span className="text-muted-foreground"> · {t('issue.raise.materialOwner')}</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="issue-due">{t('issues.field.due')}</Label>
          <Input
            id="issue-due"
            type="date"
            value={dueDate}
            min={dateFromToday(0)}
            onChange={(e) => setPickedDue(e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="issue-kind">{t('issue.raise.kindLabel')}</Label>
        <Select value={kind} onValueChange={(v) => setKind(v as IssueKind | 'none')}>
          <SelectTrigger id="issue-kind" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('issue.raise.kindNone')}</SelectItem>
            {ISSUE_KINDS.map((k) => <SelectItem key={k} value={k}>{label('live', k)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* PRD F5: for example when the reviewer disagrees with another person's approval */}
      {material.approvalId && (
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox checked={presentAtApproval} onCheckedChange={(c) => setPresentAtApproval(c === true)} />
          {t('issue.raise.presentAtApproval')}
        </Label>
      )}

      <SaveError error={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t('issue.notice.cancel')}</Button>
        <Button type="submit" disabled={!ready || pending}>{t('issue.raise.submit')}</Button>
      </DialogFooter>
    </form>
  )
}
