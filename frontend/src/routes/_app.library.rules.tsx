import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { canEditLibrary, useRules, type Rule } from '@/components/library/rule-data'
import { RuleFormDialog } from '@/components/library/rule-form-dialog'
import { ruleSearchText, sortRules, validateRulesSearch } from '@/components/library/rule-filters'
import { CheckLayerTag, PendingChangeTag } from '@/components/library/rule-meta'
import { useRuleList } from '@/components/library/use-rule-list'
import { ListFrame, ListHeader } from '@/components/list/list-frame'
import { applyFilters, listRowClass, withoutFilters, type ListSearch } from '@/components/list/list-filters'
import { ListToolbar } from '@/components/list/list-toolbar'
import { Button } from '@/components/ui/button'
import { SeverityLabel } from '@/components/ui/risk-tag'
import { formatDate } from '@/i18n/format'
import { useViewer } from '@/lib/session'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/library/rules')({
  validateSearch: validateRulesSearch,
  component: RulesTab,
})

/** The rules library (PRD F7), in the same list as Materials and Issues. Each row opens the rule. */
function RulesTab() {
  const viewer = useViewer()
  const { t } = useTranslation()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const rules = useRules()
  const { label, ...list } = useRuleList()
  const [creating, setCreating] = useState(false)

  const setSearch = (update: (prev: ListSearch) => ListSearch) => void navigate({ search: update, replace: true })

  const all = rules.data ?? []
  const shown = sortRules(applyFilters(all, search, list.fields, ruleSearchText), search)

  return (
    <div className="grid gap-4">
      <ListToolbar
        items={all}
        {...list}
        search={search}
        setSearch={setSearch}
        searchPlaceholder={t('rules.searchPlaceholder')}
        action={
          // R3: only Managers and Admins change the library. The server checks too.
          canEditLibrary(viewer.role) ? (
            <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setCreating(true)} disabled={!rules.data}>
              <Plus className="size-3.5" />
              {t('rules.editor.new')}
            </Button>
          ) : undefined
        }
      />
      <RuleFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(r) => void navigate({ to: '/library/rules/$ruleId', params: { ruleId: r.id } })}
      />

      <ListFrame
        status={rules.status}
        isEmpty={shown.length === 0}
        emptyText={t('rules.empty')}
        errorText={t('rules.loadError')}
        onClear={() => setSearch((prev) => ({ sort: withoutFilters(prev).sort }))}
      >
        <ListHeader
          columns={[
            { label: t('rules.column.title'), className: col.title },
            { label: t('rules.column.source'), className: col.source },
            { label: t('rules.column.check'), className: col.check },
            { label: t('rules.column.jurisdiction'), className: col.jurisdiction },
            { label: t('rules.column.appliesTo'), className: col.appliesTo },
            { label: t('rules.column.severity'), className: col.severity },
            { label: t('rules.column.effective'), className: col.effective },
          ]}
        />
        <ul>
          {shown.map((r) => (
            <li key={r.id} className="border-b">
              <RuleRow rule={r} label={label} />
            </li>
          ))}
        </ul>
      </ListFrame>
    </div>
  )
}

/** Column widths and breakpoints, shared by the header row and every rule row so they line up. */
const col = {
  title: 'min-w-0 flex-1',
  source: 'w-44 shrink-0 max-md:hidden',
  check: 'w-24 shrink-0 max-lg:hidden',
  jurisdiction: 'w-20 shrink-0 max-sm:hidden',
  appliesTo: 'w-48 shrink-0 max-xl:hidden',
  severity: 'w-16 shrink-0',
  effective: 'w-24 shrink-0 text-right max-sm:hidden',
}

function RuleRow({ rule: r, label }: { rule: Rule; label: ReturnType<typeof useRuleList>['label'] }) {
  const { t } = useTranslation()
  // "Personal loan, Auto loan" or "All products"; channels only when the rule is limited to some.
  const products = r.products.length ? r.products.map((p) => label('product', p)).join(', ') : t('rules.allProducts')
  const channels = r.channels.length ? ` · ${r.channels.map((c) => label('channel', c)).join(', ')}` : ''

  return (
    <Link to="/library/rules/$ruleId" params={{ ruleId: r.id }} className={listRowClass}>
      <span className={cn(col.title, 'flex items-center gap-2')}>
        <span className="truncate font-medium">{r.title}</span>
        {r.pendingChange && <PendingChangeTag />}
      </span>
      {/* The legal citation is how compliance people name a rule. Company rules have none, so they say so. */}
      <span className={cn(col.source, 'truncate text-xs text-muted-foreground')}>{r.citation?.label ?? t('rules.kind.policy')}</span>
      <CheckLayerTag layer={r.layer} className={col.check} />
      <span className={cn(col.jurisdiction, 'text-xs text-muted-foreground')}>{label('jurisdiction', r.jurisdiction)}</span>
      <span className={cn(col.appliesTo, 'truncate text-xs text-muted-foreground')} title={products + channels}>{products + channels}</span>
      <SeverityLabel level={r.severity} className={col.severity} />
      <span className={cn(col.effective, 'text-xs text-muted-foreground tabular-nums')}>{formatDate(r.effectiveDate, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
    </Link>
  )
}
