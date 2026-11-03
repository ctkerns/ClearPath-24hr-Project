import { Check, Wand2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Finding } from '@/components/review/material-detail-data'
import { TrackedText } from '@/components/review/tracked-text'
import { Button } from '@/components/ui/button'
import { SeverityLabel } from '@/components/ui/risk-tag'
import { cn } from '@/lib/utils'
import { alreadyThere, type ReviewFix, type ReviewFixes, type useReviewFixes } from './review-fixes'

/**
 * The review's findings beside the new-version form, so the submitter fixes them without going back to the review.
 * Exact fixes apply with one click (or all at once) and show as tracked changes; Undo takes one out again.
 * Findings that need the submitter's own words are listed under them, with the reviewer's advice.
 * Rule IDs are plain text here: a link would leave the form and lose the changes.
 */
export function FixesPanel({ review, state, fields }: {
  review: ReviewFixes
  state: ReturnType<typeof useReviewFixes>
  fields: Record<string, string>
}) {
  const { t } = useTranslation()
  const { fixes, manual, numbers } = review
  const open = fixes.filter((f) => !state.applied[f.id] && !alreadyThere(fields, f) && !state.stuck.has(f.id))

  return (
    <section className="grid gap-2" aria-labelledby="fixes-heading">
      <div className="flex items-center justify-between gap-2">
        <h2 id="fixes-heading" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t('fixes.heading', { count: fixes.length + manual.length })}
        </h2>
        {fixes.length > 1 && (
          <Button type="button" size="xs" variant="outline" disabled={open.length === 0} onClick={state.all}>
            <Wand2 aria-hidden="true" />
            {open.length === 0 ? t('fixes.allApplied') : t('fixes.applyAll', { count: open.length })}
          </Button>
        )}
      </div>
      {fixes.length > 0 && <p className="text-xs text-muted-foreground">{t('fixes.intro')}</p>}

      {fixes.length > 0 && (
        <ul className="grid divide-y rounded-lg border bg-card">
          {fixes.map((fix) => (
            <FixRow key={fix.id} fix={fix} numbers={numbers} state={state} present={alreadyThere(fields, fix) && !state.applied[fix.id]} />
          ))}
        </ul>
      )}

      {manual.length > 0 && (
        <>
          <h3 className="pt-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('fixes.manual', { count: manual.length })}</h3>
          <ul className="grid divide-y rounded-lg border bg-card">
            {manual.map((f) => (
              <li key={f.id} className="grid gap-1 p-2.5 text-sm">
                <FindingLine findings={[f]} numbers={numbers} />
                <p>{f.text ? <q className="font-semibold">{f.text}</q> : f.explanation}</p>
                {f.suggestion && <p className="text-xs text-primary-strong">{f.suggestion}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function FixRow({ fix, numbers, state, present }: {
  fix: ReviewFix
  numbers: Map<string, number>
  state: ReturnType<typeof useReviewFixes>
  present: boolean
}) {
  const { t } = useTranslation()
  const applied = !!state.applied[fix.id]
  const stuck = state.stuck.has(fix.id)

  return (
    <li className={cn('grid gap-1.5 p-2.5', applied && 'bg-primary-soft/40')}>
      <div className="flex items-center gap-2">
        <FindingLine findings={fix.findings} numbers={numbers} />
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {present ? (
            <span className="text-xs text-muted-foreground">{t('fixes.present')}</span>
          ) : applied ? (
            <>
              <span className="flex items-center gap-1 text-xs font-medium text-primary"><Check className="size-3.5" aria-hidden="true" />{t('fixes.applied')}</span>
              {!stuck && <Button type="button" size="xs" variant="ghost" onClick={() => state.toggle(fix, false)}>{t('fixes.undo')}</Button>}
            </>
          ) : !stuck && (
            <Button type="button" size="xs" variant="outline" onClick={() => state.toggle(fix, true)}>{t('fixes.apply')}</Button>
          )}
        </span>
      </div>
      <p className="text-sm">
        {fix.op === 'replace' ? (
          <TrackedText before={fix.from} after={fix.to} />
        ) : (
          <>
            <span className="text-xs text-muted-foreground">{t('fixes.appendTo', { field: fix.field })} </span>
            <TrackedText before="" after={fix.to} />
          </>
        )}
      </p>
      {stuck && <p role="status" className="text-xs text-risk-medium">{t('fixes.stuck', { field: fix.field })}</p>}
    </li>
  )
}

/** Finding numbers (as on the review page), severity and rule IDs, on one line. */
function FindingLine({ findings, numbers }: { findings: Finding[]; numbers: Map<string, number> }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {findings.map((f) => (
        <span key={f.id} className="grid size-[18px] place-items-center rounded-full bg-foreground font-mono text-[10.5px] font-semibold text-background">
          {numbers.get(f.id)}
        </span>
      ))}
      <SeverityLabel level={findings[0].severity} />
      <span className="truncate font-mono text-xs text-muted-foreground">{findings.map((f) => f.ruleId).join(', ')}</span>
    </span>
  )
}
