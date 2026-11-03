import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Flag } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SaveError } from '@/components/save-error'
import { hasRole } from '@/components/settings/user-data'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatRelativeTime } from '@/i18n/format'
import { api } from '@/lib/api'
import { useViewer } from '@/lib/session'
import { useSave } from '@/lib/use-save'
import type { MaterialDetail, MaterialFlag } from './material-detail-data'

/**
 * Open flags for re-review (PRD F7): a library change that the approved version depends on. The approval stays;
 * a Reviewer or higher reads the material again and resolves each flag with a note. A new version resolves them too.
 * Everyone who sees the material sees its flags, also its affiliate.
 */
export function FlagsPanel({ detail }: { detail: MaterialDetail }) {
  const viewer = useViewer()
  const { t } = useTranslation()
  const [resolving, setResolving] = useState<MaterialFlag>()
  if (detail.flags.length === 0) return null
  const canResolve = hasRole(viewer.role, 'reviewer')

  return (
    <section aria-labelledby="flags-heading" className="grid gap-2 rounded-lg border border-risk-medium/40 bg-risk-medium-soft px-3 py-2.5">
      <h2 id="flags-heading" className="flex items-center gap-2 text-sm font-semibold text-risk-medium">
        <Flag className="size-4 shrink-0" aria-hidden="true" />
        {t('flags.heading', { count: detail.flags.length })}
      </h2>
      <ul className="grid gap-2">
        {detail.flags.map((f) => (
          <li key={f.id} className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
            <div className="grid min-w-0 flex-1 gap-0.5">
              <p className="text-sm"><FlagSource flag={f} /></p>
              <p className="text-xs text-muted-foreground">
                {t('flags.meta', { version: f.version, time: formatRelativeTime(f.createdAt) })}
                {f.createdBy && ` · ${t('flags.by', { name: f.createdBy })}`}
              </p>
            </div>
            {canResolve && (
              <Button size="sm" variant="outline" className="bg-background" onClick={() => setResolving(f)}>{t('flags.resolve')}</Button>
            )}
          </li>
        ))}
      </ul>
      {!canResolve && <p className="text-xs text-muted-foreground">{t('flags.reviewerOnly')}</p>}
      <ResolveDialog materialId={detail.id} flag={resolving} onClose={() => setResolving(undefined)} />
    </section>
  )
}

/** The server's line, with a link to the library item when the viewer can read the library (not affiliates, R4). */
function FlagSource({ flag }: { flag: MaterialFlag }) {
  const viewer = useViewer()
  const { t } = useTranslation()
  if (viewer.role === 'affiliate') return <>{flag.summary}</>
  const link =
    flag.kind === 'rule_changed' ? <Link to="/library/rules/$ruleId" params={{ ruleId: flag.sourceId }} className="text-primary hover:underline">{t('flags.open.rule')}</Link>
    : flag.kind === 'disclosure_changed' ? <Link to="/library/disclosures/$disclosureId" params={{ disclosureId: flag.sourceId }} className="text-primary hover:underline">{t('flags.open.disclosure')}</Link>
    : flag.kind === 'rate_sheet_changed' ? <Link to="/library/rate-sheet" search={{ sheet: flag.sourceId }} className="text-primary hover:underline">{t('flags.open.rateSheet')}</Link>
    : <Link to="/library/regulatory-changes/$changeId" params={{ changeId: flag.sourceId }} className="text-primary hover:underline">{t('flags.open.regChange')}</Link>
  return <>{flag.summary} {link}</>
}

function ResolveDialog({ materialId, flag, onClose }: { materialId: string; flag?: MaterialFlag; onClose: () => void }) {
  return (
    <Dialog open={flag !== undefined} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {/* Mounted only while open, so each time starts with an empty note. */}
        {flag && <ResolveForm materialId={materialId} flag={flag} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function ResolveForm({ materialId, flag, onClose }: { materialId: string; flag: MaterialFlag; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const save = useSave(onClose)
  const [note, setNote] = useState('')
  const ready = note.trim().length > 0

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready || save.pending) return
        void save.run(async () => {
          // The server checks the role and writes the History entry. It returns the new detail.
          const detail = await api<MaterialDetail>('POST', `/materials/${materialId}/flags/${flag.id}/resolve`, { note: note.trim() })
          queryClient.setQueryData(['material-detail', materialId], detail)
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['materials'] }),
            queryClient.invalidateQueries({ queryKey: ['impact'] }),
          ])
        })
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('flags.dialog.title')}</DialogTitle>
        <DialogDescription>{t('flags.dialog.description', { version: flag.version })}</DialogDescription>
      </DialogHeader>
      <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{flag.summary}</p>
      <div className="grid gap-1.5">
        <Label htmlFor="flag-note">{t('flags.dialog.note')}</Label>
        <Textarea
          id="flag-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={t('flags.dialog.notePlaceholder')}
          autoFocus
        />
      </div>
      <SaveError error={save.error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t('flags.dialog.cancel')}</Button>
        <Button type="submit" disabled={!ready || save.pending}>{t('flags.dialog.confirm')}</Button>
      </DialogFooter>
    </form>
  )
}
