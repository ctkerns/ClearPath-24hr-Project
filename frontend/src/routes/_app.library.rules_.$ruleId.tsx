import { createFileRoute, Link } from '@tanstack/react-router'
import { Bot, ChevronLeft, ExternalLink, Lock, Pencil } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDisclosures } from '@/components/library/disclosure-data'
import { AffectedList } from '@/components/library/affected-materials'
import { useRuleDependents } from '@/components/library/impact-data'
import { canEditLibrary, useRules, type RuleCheck } from '@/components/library/rule-data'
import { RuleFormDialog } from '@/components/library/rule-form-dialog'
import { CheckLayerTag, PendingChangeTag } from '@/components/library/rule-meta'
import { useRuleList } from '@/components/library/use-rule-list'
import { PersonAvatar } from '@/components/materials/material-meta'
import { useViewer } from '@/lib/session'
import { Button } from '@/components/ui/button'
import { SeverityLabel } from '@/components/ui/risk-tag'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/i18n/format'

// Not nested under the Rules list route (the trailing _ in the file name), so the list does not need an Outlet.
// It still sits inside the Library layout, so the tabs stay visible and Rules stays active.
export const Route = createFileRoute('/_app/library/rules_/$ruleId')({
  component: RulePage,
})

/** One rule, read like a page in a policy manual: the rule text first, then how the tool checks it. */
function RulePage() {
  const viewer = useViewer()
  const { t } = useTranslation()
  const { ruleId } = Route.useParams()
  const rules = useRules()
  // The server works out which approved materials depend on the rule (F7): checklist, product, channel, states.
  const dependents = useRuleDependents(ruleId)
  const { label } = useRuleList()
  const rule = rules.data?.find((r) => r.id === ruleId)
  // R3: only Managers and Admins change the library. The server checks too.
  const canEdit = canEditLibrary(viewer.role)
  const [editing, setEditing] = useState(false)

  if (rules.isPending) return <RuleSkeleton />
  if (!rule) {
    return (
      <div className="grid justify-items-start gap-3">
        <BackLink />
        <p className="font-medium">{t('rules.notFound')}</p>
      </div>
    )
  }
  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <BackLink />
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{rule.citation?.label ?? t('rules.kind.policy')}</span>
          <span>{t('rules.versionShort', { version: rule.version })}</span>
          {rule.pendingChange && (
            <Link to="/library/regulatory-changes" className="hover:opacity-80"><PendingChangeTag /></Link>
          )}
        </p>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <h1 className="text-xl font-semibold">{rule.title}</h1>
          {canEdit && (
            <>
              {/* An edit saves a new version; the Versions list below shows it (F7). */}
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" />
                {t('rules.editor.edit')}
              </Button>
              <RuleFormDialog rule={rule} open={editing} onClose={() => setEditing(false)} />
            </>
          )}
        </div>
        {!canEdit && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden="true" />
            {t('rules.readOnly')}
          </p>
        )}
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-10">
        <div className="grid min-w-0 content-start gap-8">
          {/* The rule text reads like a clause in a policy document: a rule line on the left, larger text. */}
          <blockquote className="max-w-3xl border-l-2 border-primary pl-4 text-base leading-relaxed">{rule.text}</blockquote>

          <section className="grid gap-3">
            <SectionHeading>{t('rules.check.heading')}</SectionHeading>
            <CheckDescription check={rule.check} />
          </section>

          <section className="grid gap-3">
            <SectionHeading>{t('rules.versions.heading')}</SectionHeading>
            <ol className="overflow-hidden rounded-lg border">
              {rule.versions.map((v) => (
                <li key={v.version} className="grid gap-x-3 gap-y-0.5 border-b px-3 py-2 last:border-b-0 sm:grid-cols-[4rem_7rem_9rem_minmax(0,1fr)] sm:items-center">
                  <span className="text-xs font-medium">{t('rules.versionShort', { version: v.version })}{v.version === rule.version && <span className="font-normal text-muted-foreground"> · {t('rules.versions.current')}</span>}</span>
                  <time dateTime={v.effectiveDate} className="text-xs text-muted-foreground tabular-nums">{formatDate(v.effectiveDate)}</time>
                  <span className="flex items-center gap-1.5 text-xs"><PersonAvatar name={v.by} className="size-5 text-[8px]" />{v.by}</span>
                  <span>{v.note}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="grid content-start gap-6 lg:sticky lg:top-16">
          <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm">
            <Detail label={t('rules.field.jurisdiction')}>{label('jurisdiction', rule.jurisdiction)}</Detail>
            <Detail label={t('rules.field.product')}>{rule.products.length ? rule.products.map((p) => label('product', p)).join(', ') : t('rules.allProducts')}</Detail>
            <Detail label={t('rules.field.channel')}>{rule.channels.length ? rule.channels.map((c) => label('channel', c)).join(', ') : t('rules.allChannels')}</Detail>
            <Detail label={t('rules.field.severity')}><SeverityLabel level={rule.severity} /></Detail>
            <Detail label={t('rules.field.layer')}><CheckLayerTag layer={rule.layer} className="text-foreground" /></Detail>
            <Detail label={t('rules.citation')}>
              {rule.citation ? (
                <a href={rule.citation.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  {rule.citation.label}<ExternalLink className="size-3" aria-hidden="true" />
                </a>
              ) : <span className="text-muted-foreground">{t('rules.noCitation')}</span>}
            </Detail>
            <Detail label={t('rules.effective')}>{formatDate(rule.effectiveDate)}</Detail>
            <Detail label={t('rules.owner')}>
              <span className="flex items-center gap-1.5"><PersonAvatar name={rule.owner} className="size-5 text-[9px]" />{rule.owner}</span>
            </Detail>
          </dl>

          <section className="grid gap-2">
            {dependents.data ? (
              <>
                <SectionHeading>{t('rules.dependents.heading', { count: dependents.data.length })}</SectionHeading>
                <p className="text-xs text-muted-foreground">{t('rules.dependents.note')}</p>
                <AffectedList materials={dependents.data} />
              </>
            ) : <Skeleton className="h-16 w-full" />}
          </section>
        </aside>
      </div>
    </div>
  )
}

/** What the tool does for this rule, in plain words, with the terms or phrases it looks for. */
function CheckDescription({ check }: { check: RuleCheck }) {
  const { t } = useTranslation()
  switch (check.type) {
    case 'trigger_terms':
      return (
        <div className="grid gap-2">
          <p>{t('rules.check.triggerTerms')} <DisclosureLink id={check.disclosure} /></p>
          <Terms items={check.terms} />
        </div>
      )
    case 'required_disclosure':
      return <p>{t('rules.check.requiredDisclosure')} <DisclosureLink id={check.disclosure} /></p>
    case 'phrase_required':
      return (
        <div className="grid gap-2">
          <p>{t('rules.check.phraseRequired')}</p>
          <Terms items={check.phrases} />
        </div>
      )
    case 'phrase_banned':
      return (
        <div className="grid gap-2">
          <p>{t('rules.check.phraseBanned')}</p>
          <Terms items={check.phrases} />
        </div>
      )
    case 'rate_sheet':
      return (
        <p>
          {t('rules.check.rateSheet')}{' '}
          <Link to="/library/rate-sheet" className="text-primary hover:underline">{t('libraryTabs.rateSheet')}</Link>
        </p>
      )
    case 'hidden_text':
      return <p>{t('rules.check.hiddenText')}</p>
    case 'ai':
      return (
        <div className="grid gap-2">
          <p className="flex items-start gap-2">
            <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t('rules.check.ai')}
          </p>
          <p className="max-w-3xl rounded-md border bg-muted/40 px-3 py-2">{check.guidance}</p>
        </div>
      )
  }
}

/** The disclosure by its title, linked to its page. The ID shows only while the list loads. */
function DisclosureLink({ id }: { id: string }) {
  const disclosures = useDisclosures()
  const title = disclosures.data?.find((d) => d.id === id)?.title ?? id
  return (
    <Link to="/library/disclosures/$disclosureId" params={{ disclosureId: id }} className="font-medium text-primary hover:underline">
      {title}
    </Link>
  )
}

/** Terms or phrases as quiet chips, in the monospace face, because the check matches them exactly. */
function Terms({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((x) => <li key={x}><code className="rounded-sm border bg-muted/40 px-1.5 py-0.5 text-xs">{x}</code></li>)}
    </ul>
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
    <Link to="/library/rules" className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
      <ChevronLeft className="size-3.5" />
      {t('libraryTabs.rules')}
    </Link>
  )
}

function RuleSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-6 w-96 max-w-full" />
      <Skeleton className="mt-4 h-40 w-full" />
    </div>
  )
}
