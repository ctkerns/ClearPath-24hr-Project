import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Material } from '@/components/materials/material-data'
import { useViewer } from '@/lib/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SeverityLabel, type RiskLevel } from '@/components/ui/risk-tag'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { SEVERITIES } from './issue-data'
import { useRaiseIssue } from './issue-update'

/** Default time to fix, by severity. TODO: let a Manager set these in Settings. */
const daysToFix: Record<RiskLevel, number> = { high: 1, medium: 3, low: 7 }

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
export function RaiseIssueDialog({ material, people, open, onClose }: {
  material: Material
  /** People who can own the issue. TODO: read the workspace users from the API. */
  people: string[]
  open: boolean
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {/* Mounted only while open, so each time starts from clean defaults. */}
        {open && <RaiseIssueForm material={material} people={people} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function RaiseIssueForm({ material, people, onClose }: { material: Material; people: string[]; onClose: () => void }) {
  const viewer = useViewer()
  const { t } = useTranslation()
  const raise = useRaiseIssue()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [severity, setSeverity] = useState<RiskLevel>('medium')
  const [owner, setOwner] = useState(material.owner)
  const [dueDate, setDueDate] = useState(() => dateFromToday(daysToFix.medium))
  // The due date follows the severity until the person picks a date.
  const [dueTouched, setDueTouched] = useState(false)
  const ready = title.trim() && summary.trim() && dueDate

  const owners = [...new Set([material.owner, ...people, viewer.name])]

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready) return
        const id = raise(material, { title: title.trim(), summary: summary.trim(), severity, owner, dueDate })
        onClose()
        void navigate({ to: '/issues/$issueId', params: { issueId: id } })
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
              onClick={() => {
                setSeverity(level)
                if (!dueTouched) setDueDate(dateFromToday(daysToFix[level]))
              }}
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
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger id="issue-owner" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {owners.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                  {name === material.owner && <span className="text-muted-foreground"> · {t('issue.raise.materialOwner')}</span>}
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
            onChange={(e) => {
              setDueDate(e.target.value)
              setDueTouched(true)
            }}
          />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t('issue.notice.cancel')}</Button>
        <Button type="submit" disabled={!ready}>{t('issue.raise.submit')}</Button>
      </DialogFooter>
    </form>
  )
}
