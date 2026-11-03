import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { isOverdue, useIssuePage, type Issue } from '@/components/issues/issue-data'
import { ISSUE_FILTER_KEYS, validateIssuesSearch } from '@/components/issues/issue-filters'
import { IssueStatusPill } from '@/components/issues/issue-meta'
import { useIssueList } from '@/components/issues/use-issue-list'
import { ListFrame, ListHeader, ListPager } from '@/components/list/list-frame'
import { listRowClass, PAGE_SIZE, serverParams, withoutFilters, type ListSearch } from '@/components/list/list-filters'
import { ListToolbar } from '@/components/list/list-toolbar'
import { ChannelIcon, PersonAvatar } from '@/components/materials/material-meta'
import { SeverityLabel } from '@/components/ui/risk-tag'
import { formatDate } from '@/i18n/format'
import { useDebounced } from '@/lib/use-debounced'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/issues/')({
  validateSearch: validateIssuesSearch,
  component: IssuesPage,
})

function IssuesPage() {
  const { t } = useTranslation()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  // The server filters, searches, sorts and pages. The text search waits for a pause in typing.
  const q = useDebounced(search.q, 200)
  const params = serverParams({ ...search, q }, ISSUE_FILTER_KEYS)
  const issues = useIssuePage(params)
  const { label, ...list } = useIssueList()

  // Filters change often, so they replace the history entry instead of adding one. A new filter starts at the first page.
  const setSearch = (update: (prev: ListSearch) => ListSearch) =>
    void navigate({ search: (prev) => ({ ...update(prev), offset: undefined }), replace: true })
  const setOffset = (offset: number) => void navigate({ search: (prev) => ({ ...prev, offset: offset || undefined }) })

  const shown = issues.data?.items ?? []
  const total = issues.data?.total ?? 0

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4">
      <h1 className="sr-only">{t('page.issues')}</h1>

      {/* No "New issue" button: monitoring opens issues, or a reviewer raises one from a material page. */}
      <ListToolbar facets={issues.data?.facets} {...list} search={search} setSearch={setSearch} searchPlaceholder={t('issues.searchPlaceholder')} />

      <ListFrame
        status={issues.status}
        isEmpty={shown.length === 0}
        emptyText={t('issues.empty')}
        errorText={t('issues.loadError')}
        onClear={() => setSearch((prev) => ({ sort: withoutFilters(prev).sort }))}
      >
        <ListHeader
          columns={[
            { label: t('issues.column.severity'), className: col.severity },
            { label: t('issues.column.title'), className: col.title },
            { label: t('issues.column.status'), className: col.status },
            { label: t('issues.column.material'), className: col.material },
            { label: t('issues.column.source'), className: col.source },
            { label: t('issues.column.due'), className: col.due },
            { className: col.owner },
          ]}
        />
        {/* Dimmed while the next page or filter loads; the last one stays until then. */}
        <ul className={cn(issues.isPlaceholderData && 'opacity-60 transition-opacity')}>
          {shown.map((issue) => (
            <li key={issue.id} className="border-b">
              <IssueRow issue={issue} sourceLabel={label('source', issue.source)} />
            </li>
          ))}
        </ul>
      </ListFrame>
      {issues.data && (
        <ListPager total={total} offset={search.offset ?? 0} pageSize={PAGE_SIZE} countText={t('issues.count', { count: total })} onOffset={setOffset} />
      )}
    </div>
  )
}

/** Column widths and breakpoints, shared by the header row and every issue row so they line up. */
const col = {
  severity: 'w-16 shrink-0',
  title: 'min-w-0 flex-1',
  status: 'w-24 shrink-0 max-sm:hidden',
  material: 'flex w-72 shrink-0 items-center gap-2 max-lg:hidden',
  source: 'w-24 shrink-0 max-xl:hidden',
  due: 'w-24 shrink-0 text-right max-sm:hidden',
  owner: 'w-6 shrink-0',
}

/** One issue on one line: severity, title, status, then the linked material, source, due date and owner. */
function IssueRow({ issue: i, sourceLabel }: { issue: Issue; sourceLabel: string }) {
  const { t } = useTranslation()
  const overdue = isOverdue(i)
  const short = (date: string) => formatDate(date, { month: 'short', day: 'numeric' })

  return (
    <Link to="/issues/$issueId" params={{ issueId: i.id }} className={listRowClass}>
      <SeverityLabel level={i.severity} className={col.severity} />
      <span className={cn(col.title, 'flex items-center gap-2')}>
        <span className={cn('truncate font-medium', i.status === 'resolved' && 'text-muted-foreground')}>{i.title}</span>
        {i.affiliate && <span className="shrink-0 rounded-sm border px-1 text-[11px] text-muted-foreground max-md:hidden">{i.affiliate}</span>}
      </span>
      <span className={col.status}><IssueStatusPill status={i.status} /></span>

      {/* Plain text, not a link: the whole row is already one link. The issue page links to the material. */}
      <span className={cn(col.material, 'text-xs text-muted-foreground')}>
        <ChannelIcon channel={i.channel} className="size-3.5 shrink-0" />
        <span className="truncate">{i.material?.title ?? t('issues.noMaterial')}</span>
      </span>

      <span className={cn(col.source, 'text-xs text-muted-foreground')}>{sourceLabel}</span>

      <span className={cn(col.due, 'text-xs tabular-nums')}>
        {i.resolvedAt ? (
          <span className="text-muted-foreground" title={t('issues.resolvedOn', { date: formatDate(i.resolvedAt) })}>
            {t('issues.resolvedShort', { date: short(i.resolvedAt) })}
          </span>
        ) : (
          <span title={t('issues.dueOn', { date: formatDate(i.dueAt) })} className={overdue ? 'font-medium text-risk-high' : 'text-muted-foreground'}>
            {overdue ? t('issues.overdueShort', { date: short(i.dueAt) }) : short(i.dueAt)}
          </span>
        )}
      </span>

      <PersonAvatar name={i.owner} className={col.owner} />
    </Link>
  )
}
