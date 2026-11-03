import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronLeft, ExternalLink, Lock } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { affectedRules, flaggedMaterials, isUndecided, useRegChanges, type RegChange, type RegChangeDecision } from '@/components/library/reg-change-data'
import { RegChangeDecisionDialog } from '@/components/library/reg-change-decision-dialog'
import { RegChangeStatusPill } from '@/components/library/reg-change-meta'
import { useRules, type Rule } from '@/components/library/rule-data'
import { useMaterials } from '@/components/materials/material-data'
import { ChannelIcon, PersonAvatar } from '@/components/materials/material-meta'
import { useViewer } from '@/lib/session'
import { TrackedText } from '@/components/review/tracked-text'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPill } from '@/components/ui/status-pill'
import { formatDate } from '@/i18n/format'

// Not nested under the list route (the trailing _ in the file name), so the list does not need an Outlet.
// It still sits inside the Library layout, so the tabs stay visible and Regulatory changes stays active.
export const Route = createFileRoute('/_app/library/regulatory-changes_/$changeId')({
  component: RegChangePage,
})

/** One regulatory change, read like a redline: what the agency said, then the edit it implies for each rule. */
function RegChangePage() {
  const viewer = useViewer()
  const { t } = useTranslation()
  const { changeId } = Route.useParams()
  const changes = useRegChanges()
  const rules = useRules()
  const materials = useMaterials()
  const change = changes.data?.find((c) => c.id === changeId)
  // R3: only Managers and Admins change the library, so only they apply or dismiss a change.
  const canDecide = viewer.role === 'manager' || viewer.role === 'admin'

  if (changes.isPending || rules.isPending) return <RegChangeSkeleton />
  if (!change) {
    return (
      <div className="grid justify-items-start gap-3">
        <BackLink />
        <p className="font-medium">{t('regChanges.notFound')}</p>
      </div>
    )
  }
  const ruleList = rules.data ?? []
  const affected = affectedRules(change, ruleList)
  const flagged = flaggedMaterials(change, ruleList, materials.data ?? [])
  const open = isUndecided(change)

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <BackLink />
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{change.agency}</span>
          <a href={change.citation.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            {change.citation.label}<ExternalLink className="size-3" aria-hidden="true" />
          </a>
          <span>{t('regChanges.published', { date: formatDate(change.publishedAt) })}</span>
          <span>{t('regChanges.effectiveOn', { date: formatDate(change.effectiveDate) })}</span>
        </p>
        <h1 className="text-xl font-semibold">{change.title}</h1>
        {open && !canDecide && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden="true" />
            {t('regChanges.readOnly')}
          </p>
        )}
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-10">
        <div className="grid min-w-0 content-start gap-8">
          <p className="max-w-3xl text-base leading-relaxed">{change.summary}</p>

          <section className="grid gap-3">
            <SectionHeading>{t(`regChanges.edit.${change.status}`)}</SectionHeading>
            {open && <p className="text-xs text-muted-foreground">{t('regChanges.editNote')}</p>}
            {change.edits.map((e) => (
              <RuleEditBlock key={e.ruleId} before={e.before} after={e.after} rule={ruleList.find((r) => r.id === e.ruleId)} />
            ))}
          </section>

          {change.decidedBy && change.decidedAt && (
            <section className="grid gap-3">
              <SectionHeading>{t('regChanges.decision.heading')}</SectionHeading>
              <div className="grid max-w-3xl gap-1.5">
                <p className="flex items-center gap-1.5 text-sm">
                  <PersonAvatar name={change.decidedBy} className="size-5 text-[9px]" />
                  {t(change.status === 'dismissed' ? 'regChanges.decision.dismissed' : 'regChanges.decision.applied', { name: change.decidedBy, date: formatDate(change.decidedAt) })}
                </p>
                {change.decisionNote && <p className="pl-6.5">{change.decisionNote}</p>}
              </div>
            </section>
          )}
        </div>

        <aside className="grid content-start gap-6 lg:sticky lg:top-16">
          {open && <DecisionActions change={change} canDecide={canDecide} />}

          <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm">
            <Detail label={t('regChanges.detail.status')}><RegChangeStatusPill status={change.status} /></Detail>
            <Detail label={t('regChanges.detail.agency')}>{change.agency}</Detail>
            <Detail label={t('regChanges.detail.published')}>{formatDate(change.publishedAt)}</Detail>
            <Detail label={t('regChanges.detail.effective')}>{formatDate(change.effectiveDate)}</Detail>
            <Detail label={t('regChanges.detail.source')}>
              {change.source}
              <span className="block text-xs text-muted-foreground">{t('regChanges.sourceNote')}</span>
            </Detail>
          </dl>

          <section className="grid gap-2">
            <SectionHeading>{t('regChanges.rules.heading', { count: affected.length })}</SectionHeading>
            <ul className="overflow-hidden rounded-lg border">
              {affected.map((r) => (
                <li key={r.id} className="border-b last:border-b-0">
                  <Link to="/library/rules/$ruleId" params={{ ruleId: r.id }} className="grid gap-0.5 px-3 py-2 text-sm transition-colors hover:bg-muted/60">
                    <span className="truncate">{r.title}</span>
                    <span className="text-xs text-muted-foreground">{r.citation?.label ?? t('rules.kind.policy')}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="grid gap-2">
            <SectionHeading>{t('regChanges.flagged.heading', { count: flagged.length })}</SectionHeading>
            <p className="text-xs text-muted-foreground">{t(`regChanges.flagged.${change.status}`)}</p>
            {flagged.length > 0 && change.status !== 'dismissed' && (
              <ul className="overflow-hidden rounded-lg border">
                {flagged.map((m) => (
                  <li key={m.id} className="border-b last:border-b-0">
                    <Link to="/materials/$materialId" params={{ materialId: m.id }} className="flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-muted/60">
                      <ChannelIcon channel={m.channel} className="size-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{m.title}</span>
                      <StatusPill status={m.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}

/** One rule's text with the suggested edit marked as tracked changes, under the rule's title. */
function RuleEditBlock({ rule, before, after }: { rule?: Rule; before: string; after: string }) {
  return (
    <div className="grid max-w-3xl gap-1.5">
      {rule && (
        <Link to="/library/rules/$ruleId" params={{ ruleId: rule.id }} className="w-fit text-sm font-medium hover:underline">
          {rule.title}
        </Link>
      )}
      <blockquote className="border-l-2 border-primary pl-4 text-base leading-relaxed">
        <TrackedText before={before} after={after} />
      </blockquote>
    </div>
  )
}

/** Apply and Dismiss, shown to everyone so the next step is clear, but only Managers can use them. */
function DecisionActions({ change, canDecide }: { change: RegChange; canDecide: boolean }) {
  const { t } = useTranslation()
  // The server checks the role too. Applying writes a new rule version (F7).
  const [decision, setDecision] = useState<RegChangeDecision>()
  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <Button size="sm" disabled={!canDecide} title={canDecide ? undefined : t('regChanges.readOnly')} onClick={() => setDecision('apply')}>{t('regChanges.apply')}</Button>
        <Button size="sm" variant="outline" disabled={!canDecide} title={canDecide ? undefined : t('regChanges.readOnly')} onClick={() => setDecision('dismiss')}>{t('regChanges.dismiss')}</Button>
      </div>
      <RegChangeDecisionDialog change={change} decision={decision} onClose={() => setDecision(undefined)} />
      {change.reviewingBy && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <PersonAvatar name={change.reviewingBy} className="size-4 text-[8px]" />
          {t('regChanges.reviewingBy', { name: change.reviewingBy })}
        </p>
      )}
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</h2>
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link to="/library/regulatory-changes" className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
      <ChevronLeft className="size-3.5" />
      {t('libraryTabs.regulatoryChanges')}
    </Link>
  )
}

function RegChangeSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-6 w-96 max-w-full" />
      <Skeleton className="mt-4 h-40 w-full" />
    </div>
  )
}
