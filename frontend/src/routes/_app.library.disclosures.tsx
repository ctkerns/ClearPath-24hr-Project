import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useDisclosures, type Disclosure } from '@/components/library/disclosure-data'
import { disclosureSearchText, sortDisclosures, validateDisclosuresSearch } from '@/components/library/disclosure-filters'
import { useDisclosureList } from '@/components/library/use-disclosure-list'
import { ListFrame, ListHeader } from '@/components/list/list-frame'
import { applyFilters, listRowClass, withoutFilters, type ListSearch } from '@/components/list/list-filters'
import { ListToolbar } from '@/components/list/list-toolbar'
import { formatDate } from '@/i18n/format'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/library/disclosures')({
  validateSearch: validateDisclosuresSearch,
  component: DisclosuresTab,
})

/** The disclosure library (PRD F8). The text is the point, so each row shows it, not only the title. */
function DisclosuresTab() {
  const { t } = useTranslation()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const disclosures = useDisclosures()
  const { label, ...list } = useDisclosureList()

  const setSearch = (update: (prev: ListSearch) => ListSearch) => void navigate({ search: update, replace: true })

  const all = disclosures.data ?? []
  const shown = sortDisclosures(applyFilters(all, search, list.fields, disclosureSearchText), search)

  return (
    <div className="grid gap-4">
      <ListToolbar items={all} {...list} search={search} setSearch={setSearch} searchPlaceholder={t('disclosures.searchPlaceholder')} />

      <ListFrame
        status={disclosures.status}
        isEmpty={shown.length === 0}
        emptyText={t('disclosures.empty')}
        errorText={t('disclosures.loadError')}
        onClear={() => setSearch((prev) => ({ sort: withoutFilters(prev).sort }))}
      >
        <ListHeader
          columns={[
            { label: t('disclosures.column.text'), className: col.text },
            { label: t('disclosures.column.products'), className: col.products },
            { label: t('disclosures.column.states'), className: col.states },
            { label: t('disclosures.column.version'), className: col.version },
            { label: t('disclosures.column.effective'), className: col.effective },
          ]}
        />
        <ul>
          {shown.map((d) => (
            <li key={d.id} className="border-b">
              <DisclosureRow disclosure={d} label={label} />
            </li>
          ))}
        </ul>
      </ListFrame>
    </div>
  )
}

const col = {
  text: 'min-w-0 flex-1',
  products: 'w-48 shrink-0 max-lg:hidden',
  states: 'w-24 shrink-0 max-md:hidden',
  version: 'w-12 shrink-0 max-sm:hidden',
  effective: 'w-24 shrink-0 text-right max-sm:hidden',
}

function DisclosureRow({ disclosure: d, label }: { disclosure: Disclosure; label: ReturnType<typeof useDisclosureList>['label'] }) {
  const { t } = useTranslation()
  const products = d.products.length ? d.products.map((p) => label('product', p)).join(', ') : t('rules.allProducts')
  const states = d.states === 'all' ? t('rules.allStates') : d.states.join(', ')

  return (
    // Taller than the other lists: two lines of the approved text show under the title.
    <Link to="/library/disclosures/$disclosureId" params={{ disclosureId: d.id }} className={cn(listRowClass, 'h-auto items-start py-2.5')}>
      <span className={cn(col.text, 'grid gap-0.5')}>
        <span className="truncate font-medium">{d.title}</span>
        <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{d.text}</span>
      </span>
      <span className={cn(col.products, 'pt-0.5 text-xs text-muted-foreground')}>{products}</span>
      <span className={cn(col.states, 'pt-0.5 text-xs text-muted-foreground')}>{states}</span>
      <span className={cn(col.version, 'pt-0.5 text-xs text-muted-foreground tabular-nums')}>{t('rules.versionShort', { version: d.version })}</span>
      <span className={cn(col.effective, 'pt-0.5 text-xs text-muted-foreground tabular-nums')}>{formatDate(d.effectiveDate, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
    </Link>
  )
}
