import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SaveError } from '@/components/save-error'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useSave } from '@/lib/use-save'
import { useDecideRegChange, type RegChange, type RegChangeDecision } from './reg-change-data'

/**
 * Confirm Apply or Dismiss on a regulatory change (PRD F7, Managers only, R3).
 * Apply takes an optional note for the rule's version history. Dismiss needs a reason, for the audit trail.
 */
export function RegChangeDecisionDialog({ change, decision, onClose }: {
  change: RegChange
  /** The button the Manager pressed. Leave it out to close the dialog. */
  decision?: RegChangeDecision
  onClose: () => void
}) {
  return (
    <Dialog open={decision !== undefined} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {/* Mounted only while open, so each time starts with an empty note. */}
        {decision && <DecisionForm change={change} decision={decision} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function DecisionForm({ change, decision, onClose }: { change: RegChange; decision: RegChangeDecision; onClose: () => void }) {
  const { t } = useTranslation()
  const decide = useDecideRegChange()
  const save = useSave(onClose)
  const [note, setNote] = useState('')
  const dismissing = decision === 'dismiss'
  const ready = !dismissing || note.trim().length > 0

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready || save.pending) return
        void save.run(() => decide(change.id, decision, note.trim()))
      }}
    >
      <DialogHeader>
        <DialogTitle>{t(dismissing ? 'regChanges.decide.dismissTitle' : 'regChanges.decide.applyTitle')}</DialogTitle>
        <DialogDescription>
          {dismissing ? t('regChanges.decide.dismissDescription') : t('regChanges.decide.applyDescription', { count: change.edits.length })}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="decision-note">{t(dismissing ? 'regChanges.decide.note' : 'regChanges.decide.noteOptional')}</Label>
        <Textarea
          id="decision-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={dismissing ? t('regChanges.decide.notePlaceholder') : undefined}
          autoFocus
        />
      </div>

      <SaveError error={save.error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t('regChanges.decide.cancel')}</Button>
        <Button type="submit" disabled={!ready || save.pending}>
          {t(dismissing ? 'regChanges.decide.confirmDismiss' : 'regChanges.decide.confirmApply')}
        </Button>
      </DialogFooter>
    </form>
  )
}
