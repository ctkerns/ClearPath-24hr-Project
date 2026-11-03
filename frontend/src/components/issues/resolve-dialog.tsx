import { CircleAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { IssueDetail } from './issue-data'
import { useIssueUpdate } from './issue-update'

/**
 * Resolving needs a note on how the problem was fixed, because auditors read it later.
 * Steps that are not done show as a warning, not a block: one of two alternative steps is often enough.
 */
export function ResolveDialog({ issueId, detail, open, onClose }: { issueId: string; detail: IssueDetail | null; open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const { setStatus } = useIssueUpdate(issueId)
  const [note, setNote] = useState('')
  const open_ = detail?.actions.filter((a) => !a.done).length ?? 0

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            setStatus('resolved', note.trim())
            setNote('')
            onClose()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('issue.resolve.title')}</DialogTitle>
            <DialogDescription>{t('issue.resolve.description')}</DialogDescription>
          </DialogHeader>
          {open_ > 0 && (
            <p className="flex items-start gap-2 rounded-md border border-risk-medium/40 bg-risk-medium-soft px-3 py-2 text-xs">
              <CircleAlert className="mt-px size-3.5 shrink-0 text-risk-medium" aria-hidden="true" />
              {t('issue.resolve.openActions', { count: open_ })}
            </p>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="resolve-note">{t('issue.resolve.noteLabel')}</Label>
            <Textarea id="resolve-note" value={note} onChange={(e) => setNote(e.target.value)} rows={4} required />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t('issue.notice.cancel')}</Button>
            <Button type="submit" disabled={!note.trim()}>{t('issue.resolve.submit')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
