import { CircleAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useGroupNames } from '@/components/settings/group-data'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { approvedByViewer, groupsForViewer, useDecide } from './decide'
import { checkState } from './check-state'
import type { Decision, MaterialDetail } from './material-detail-data'
import { useViewer } from '@/lib/session'
import { useSave } from '@/lib/use-save'
import { SaveError } from '@/components/save-error'

/** Which decisions need text before they can be sent. Approve alone takes an optional comment. */
const textRequired: Record<Decision, boolean> = {
  approve: false,
  approve_conditions: true,
  request_changes: true,
  reject: true,
  escalate: true,
  retract: true,
}

/**
 * One dialog for every decision. It says which groups the decision counts for and what happens next,
 * so nobody approves for a group by accident.
 */
export function DecisionDialog({ decision, detail, materialId, onClose }: {
  decision: Decision | null
  detail: MaterialDetail
  materialId: string
  onClose: () => void
}) {
  return (
    <Dialog open={decision !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {/* A new key resets the form each time the dialog opens. */}
        {decision && <DecisionForm key={decision} decision={decision} detail={detail} materialId={materialId} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function DecisionForm({ decision, detail, materialId, onDone }: { decision: Decision; detail: MaterialDetail; materialId: string; onDone: () => void }) {
  const viewer = useViewer()
  const { t } = useTranslation()
  const decide = useDecide(materialId)
  const { pending, error, run } = useSave(onDone)
  const [text, setText] = useState('')
  const [group, setGroup] = useState<string>()
  const [override, setOverride] = useState('')

  const mine = decision === 'retract' ? approvedByViewer(detail, viewer) : groupsForViewer(detail, viewer)
  const openFindings = detail.findings.filter((f) => f.status === 'open').length
  // Approving while the checks are running, did not run, or had no rules: say that "no findings" is not a clean result.
  const checks = checkState(detail.checklist).kind
  const checksWarning = ({ running: 'review.dialog.checksRunning', ai_not_run: 'review.dialog.checksNotRun', no_rules: 'review.dialog.checksNoRules', done: null } as const)[checks]
  const othersWaiting = detail.groups.filter((g) => g.state !== 'approved' && !mine.includes(g.name)).map((g) => g.name)
  const isApprove = decision === 'approve' || decision === 'approve_conditions'
  // An open High finding blocks approval unless the Reviewer writes an override reason (PRD F6).
  const highOpen = detail.findings.filter((f) => f.status === 'open' && f.severity === 'high').length
  const needsOverride = isApprove && highOpen > 0
  // Escalate to any reviewer group from Settings that is not already required.
  const escalateOptions = useGroupNames().filter((name) => !detail.groups.some((g) => g.name === name))
  const ready = (!textRequired[decision] || text.trim().length > 0) && (decision !== 'escalate' || group) && (!needsOverride || override.trim().length > 0)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!ready) return
    void run(() => decide({ decision, text: text.trim(), group, override: needsOverride ? override.trim() : undefined }))
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t(`review.dialog.${decision}.title`)}</DialogTitle>
        <DialogDescription>
          {decision === 'escalate'
            ? t('review.dialog.escalate.description')
            : t('review.dialog.countsFor', { groups: mine.join(', ') })}
        </DialogDescription>
      </DialogHeader>

      {/* What happens next. */}
      {isApprove && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs">
          {othersWaiting.length
            ? t('review.dialog.stillWaiting', { groups: othersWaiting.join(', ') })
            : t('review.dialog.lastGroup')}
        </p>
      )}
      {isApprove && checksWarning && (
        <p className="flex gap-2 rounded-md bg-risk-medium-soft px-3 py-2 text-xs text-risk-medium">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          {t(checksWarning)}
        </p>
      )}
      {isApprove && openFindings > 0 && !needsOverride && (
        <p className="flex gap-2 rounded-md bg-risk-medium-soft px-3 py-2 text-xs text-risk-medium">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          {t('review.dialog.openFindings', { count: openFindings })}
        </p>
      )}
      {needsOverride && (
        <div className="grid gap-1.5 rounded-md border border-risk-high/40 bg-risk-high-soft p-3">
          <Label htmlFor="override-text" className="flex items-center gap-1.5 text-risk-high">
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
            {t('review.dialog.override.label', { count: highOpen })}
          </Label>
          <Textarea
            id="override-text"
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            placeholder={t('review.dialog.override.placeholder')}
            required
            className="min-h-16"
          />
          <p className="text-xs text-risk-high">{t('review.dialog.override.help')}</p>
        </div>
      )}

      {decision === 'escalate' && (
        <div className="grid gap-1.5">
          <Label htmlFor="escalate-group">{t('review.dialog.escalate.group')}</Label>
          <Select value={group} onValueChange={setGroup}>
            <SelectTrigger id="escalate-group" className="w-full">
              <SelectValue placeholder={t('review.dialog.escalate.groupPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {escalateOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="decision-text">
          {t(`review.dialog.${decision}.label`)}
          {!textRequired[decision] && <span className="font-normal text-muted-foreground"> {t('review.dialog.optional')}</span>}
        </Label>
        <Textarea
          id="decision-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t(`review.dialog.${decision}.placeholder`)}
          required={textRequired[decision]}
          className="min-h-24"
          autoFocus
        />
        <p className="text-xs text-muted-foreground">{t(`review.dialog.${decision}.help`)}</p>
      </div>

      <SaveError error={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>{t('review.dialog.cancel')}</Button>
        <Button type="submit" variant={decision === 'reject' ? 'destructive' : 'default'} disabled={!ready || pending}>
          {t(`review.dialog.${decision}.confirm`)}
        </Button>
      </DialogFooter>
    </form>
  )
}
