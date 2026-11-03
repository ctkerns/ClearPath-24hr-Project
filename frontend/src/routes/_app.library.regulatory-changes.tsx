import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { affectedRules, useRegChanges, type RegChange } from '@/components/library/reg-change-data'
import { regChangeSearchText, sortRegChanges, validateRegChangesSearch } from '@/components/library/reg-change-filters'
import { useRegChangeList } from '@/components/library/reg-change-list'
import { RegChangeStatusPill } from '@/components/library/reg-change-meta'
import { useRules, type Rule } from '@/components/library/rule-data'
import { ListFrame, ListHeader } from '@/components/list/list-frame'
import { applyFilters, listRowClass, withoutFilters, type ListSearch } from '@/components/list/list-filters'
import { ListToolbar } from '@/components/list/list-toolbar'
import { formatDate } from '@/i18n/format'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/library/regulatory-changes')({
  validateSearch: validateRegChangesSearch,
  component: RegulatoryChangesTab,
})

/** The regulatory change queue (PRD F7, screen 7). Each row opens the change and its suggested rule edit. */
function RegulatoryChangesTab() {
  const { t } = useTranslation()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const changes = useRegChanges()
  const rules = useRules()
  const all = changes.data ?? []
  const ruleList = rules.data ?? []
  const list = useRegChangeList(all, ruleList)

  const setSearch = (update: (prev: ListSearch) => ListSearch) => void navigate({ search: update, replace: true })

  const shown = sortRegChanges(applyFilters(all, search, list.fields, regChangeSearchText), search)
  // The product filter and the rule titles need the rules too, so the list waits for both.
  const status = changes.status === 'success' ? rules.status : changes.status

  return (
    <div className="grid gap-4">
      {/* No "Add change" button: the feed connector adds items (F7), and only Managers decide them (R3). */}
      <ListToolbar items={all} {...list} search={search} setSearch={setSearch} searchPlaceholder={t('regChanges.searchPlaceholder')} />

      <ListFrame
        status={status}
        isEmpty={shown.length === 0}
        emptyText={t('regChanges.empty')}
        errorText={t('regChanges.loadError')}
        onClear={() => setSearch((prev) => ({ sort: withoutFilters(prev).sort }))}
      >
        <ListHeader
          columns={[
            { label: t('regChanges.column.title'), className: col.title },
            { label: t('regChanges.column.agency'), className: col.agency },
            { label: t('regChanges.column.status'), className: col.status },
            { label: t('regChanges.column.rules'), className: col.rules },
            { label: t('regChanges.column.effective'), className: col.effective },
          ]}
        />
        <ul>
          {shown.map((c) => (
            <li key={c.id} className="border-b">
              <RegChangeRow change={c} rules={ruleList} />
            </li>
          ))}
        </ul>
      </ListFrame>
    </div>
  )
}

/** Column widths and breakpoints, shared by the header row and every row so they line up. */
const col = {
  title: 'min-w-0 flex-1',
  agency: 'w-28 shrink-0 max-md:hidden',
  status: 'w-20 shrink-0',
  rules: 'w-64 shrink-0 max-lg:hidden',
  effective: 'w-24 shrink-0 text-right max-sm:hidden',
}

function RegChangeRow({ change: c, rules }: { change: RegChange; rules: Rule[] }) {
  const titles = affectedRules(c, rules).map((r) => r.title).join(', ')
  return (
    <Link to="/library/regulatory-changes/$changeId" params={{ changeId: c.id }} className={listRowClass}>
      <span className={cn(col.title, 'truncate font-medium')}>{c.title}</span>
      <span className={cn(col.agency, 'truncate text-xs text-muted-foreground')}>{c.agency}</span>
      <span className={col.status}><RegChangeStatusPill status={c.status} /></span>
      <span className={cn(col.rules, 'truncate text-xs text-muted-foreground')} title={titles}>{titles}</span>
      <time dateTime={c.effectiveDate} className={cn(col.effective, 'text-xs text-muted-foreground tabular-nums')}>
        {formatDate(c.effectiveDate, { month: 'short', day: 'numeric', year: 'numeric' })}
      </time>
    </Link>
  )
}
