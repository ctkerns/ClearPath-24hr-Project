import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronLeft, Lock, Pencil } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyButton } from '@/components/library/copy-button'
import { requiredBy, useDisclosures } from '@/components/library/disclosure-data'
import { DisclosureFormDialog } from '@/components/library/disclosure-form-dialog'
import { AffectedList } from '@/components/library/affected-materials'
import { useDisclosureDependents } from '@/components/library/impact-data'
import { canEditLibrary, useRules } from '@/components/library/rule-data'
import { useDisclosureList } from '@/components/library/use-disclosure-list'
import { PersonAvatar } from '@/components/materials/material-meta'
import { useViewer } from '@/lib/session'
import { TrackedText } from '@/components/review/tracked-text'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/i18n/format'

// Not nested under the Disclosures list route (trailing _), but still inside the Library layout and its tabs.
export const Route = createFileRoute('/_app/library/disclosures_/$disclosureId')({
  component: DisclosurePage,
})

/**
 * One disclosure: the exact approved text to copy, where it must go, and how it changed over time.
 * Version changes use the same track-changes marks as the material page.
 */
function DisclosurePage() {
  const viewer = useViewer()
  const { t } = useTranslation()
  const { disclosureId } = Route.useParams()
  const disclosures = useDisclosures()
  const rules = useRules()
  // The approved materials that a new version flags for re-review (F7, F15). The server works it out.
  const dependents = useDisclosureDependents(disclosureId)
  const { label } = useDisclosureList()
  const d = disclosures.data?.find((x) => x.id === disclosureId)
  // R3: only Managers and Admins change the library. The server checks too.
  const canEdit = canEditLibrary(viewer.role)
  const [editing, setEditing] = useState(false)

  if (disclosures.isPending) return <PageSkeleton />
  if (!d) {
    return (
      <div className="grid justify-items-start gap-3">
        <BackLink />
        <p className="font-medium">{t('disclosures.notFound')}</p>
      </div>
    )
  }
  const rulesThatNeedIt = requiredBy(d, rules.data ?? [])

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <BackLink />
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{t('rules.versionShort', { version: d.version })}</span>
          <span>{t('disclosures.effectiveOn', { date: formatDate(d.effectiveDate) })}</span>
        </p>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <h1 className="text-xl font-semibold">{d.title}</h1>
          {canEdit && (
            <>
              {/* An edit saves a new version with its full text; the Versions list below shows what changed (F8). */}
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" />
                {t('disclosures.editor.edit')}
              </Button>
              <DisclosureFormDialog disclosure={d} open={editing} onClose={() => setEditing(false)} />
            </>
          )}
        </div>
        {!canEdit && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden="true" />
            {t('disclosures.readOnly')}
          </p>
        )}
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-10">
        <div className="grid min-w-0 content-start gap-8">
          <section className="grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <SectionHeading>{t('disclosures.approvedText')}</SectionHeading>
              <CopyButton text={d.text} />
            </div>
            <p className="max-w-3xl rounded-lg border bg-card p-4 text-base leading-relaxed">{d.text}</p>
            <p className="max-w-3xl text-sm">
              <span className="font-medium">{t('disclosures.placement')}</span> {d.placement}
            </p>
          </section>

          <section className="grid gap-3">
            <SectionHeading>{t('rules.versions.heading')}</SectionHeading>
            <ol className="overflow-hidden rounded-lg border">
              {d.versions.map((v, i) => {
                const previous = d.versions[i + 1]
                return (
                  <li key={v.version} className="grid gap-2 border-b px-3 py-3 last:border-b-0">
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="font-medium">
                        {t('rules.versionShort', { version: v.version })}
                        {v.version === d.version && <span className="font-normal text-muted-foreground"> · {t('rules.versions.current')}</span>}
                      </span>
                      <time dateTime={v.effectiveDate} className="text-muted-foreground tabular-nums">{formatDate(v.effectiveDate)}</time>
                      <span className="flex items-center gap-1.5"><PersonAvatar name={v.by} className="size-5 text-[8px]" />{v.by}</span>
                    </p>
                    <p className="text-sm">{v.note}</p>
                    {/* Each version shows what changed from the one before it. The first version shows its plain text. */}
                    <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
                      {previous ? <TrackedText before={previous.text} after={v.text} /> : v.text}
                    </p>
                  </li>
                )
              })}
            </ol>
          </section>
        </div>

        <aside className="grid content-start gap-6 lg:sticky lg:top-16">
          <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm">
            <dt className="text-muted-foreground">{t('disclosures.field.product')}</dt>
            <dd>{d.products.length ? d.products.map((p) => label('product', p)).join(', ') : t('rules.allProducts')}</dd>
            <dt className="text-muted-foreground">{t('disclosures.field.state')}</dt>
            <dd>{d.states === 'all' ? t('rules.allStates') : d.states.join(', ')}</dd>
            <dt className="text-muted-foreground">{t('rules.effective')}</dt>
            <dd>{formatDate(d.effectiveDate)}</dd>
            <dt className="text-muted-foreground">{t('rules.owner')}</dt>
            <dd className="flex items-center gap-1.5"><PersonAvatar name={d.owner} className="size-5 text-[9px]" />{d.owner}</dd>
          </dl>

          <section className="grid gap-2">
            <SectionHeading>{t('disclosures.requiredBy', { count: rulesThatNeedIt.length })}</SectionHeading>
            {rulesThatNeedIt.length ? (
              <ul className="grid gap-2">
                {rulesThatNeedIt.map((r) => (
                  <li key={r.id}>
                    <Link to="/library/rules/$ruleId" params={{ ruleId: r.id }} className="group grid gap-0.5 text-sm">
                      <span className="group-hover:underline">{r.title}</span>
                      <span className="text-xs text-muted-foreground">{r.citation?.label ?? t('rules.kind.policy')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">{t('disclosures.notRequired')}</p>
            )}
          </section>

          <section className="grid gap-2">
            {dependents.data ? (
              <>
                <SectionHeading>{t('disclosures.dependents.heading', { count: dependents.data.length })}</SectionHeading>
                <p className="text-xs text-muted-foreground">{t('disclosures.dependents.note')}</p>
                <AffectedList materials={dependents.data} />
              </>
            ) : <Skeleton className="h-16 w-full" />}
          </section>
        </aside>
      </div>
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</h2>
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link to="/library/disclosures" className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
      <ChevronLeft className="size-3.5" />
      {t('libraryTabs.disclosures')}
    </Link>
  )
}

function PageSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-6 w-96 max-w-full" />
      <Skeleton className="mt-4 h-40 w-full" />
    </div>
  )
}
