import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useBlocks, type Block } from '@/components/library/block-data'
import { blockSearchText, sortBlocks, validateBlocksSearch } from '@/components/library/block-filters'
import { BlockExpiry, BlockKindLabel } from '@/components/library/block-meta'
import { useBlockList } from '@/components/library/use-block-list'
import { ListFrame, ListHeader } from '@/components/list/list-frame'
import { applyFilters, listRowClass, withoutFilters, type ListSearch } from '@/components/list/list-filters'
import { ListToolbar } from '@/components/list/list-toolbar'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/library/building-blocks')({
  validateSearch: validateBlocksSearch,
  component: BuildingBlocksTab,
})

/** Pre-approved building blocks (PRD F9). The list is about the words, so each row shows the full text. */
function BuildingBlocksTab() {
  const { t } = useTranslation()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const blocks = useBlocks()
  const { label, ...list } = useBlockList()

  const setSearch = (update: (prev: ListSearch) => ListSearch) => void navigate({ search: update, replace: true })

  const all = blocks.data ?? []
  const shown = sortBlocks(applyFilters(all, search, list.fields, blockSearchText), search)

  return (
    <div className="grid gap-4">
      {/* No "New block" button: blocks come from "Save to library" on an approved material (F9), and Managers curate them on each block's page (R3). */}
      <ListToolbar items={all} {...list} search={search} setSearch={setSearch} searchPlaceholder={t('blocks.searchPlaceholder')} />

      <ListFrame
        status={blocks.status}
        isEmpty={shown.length === 0}
        emptyText={t('blocks.empty')}
        errorText={t('blocks.loadError')}
        onClear={() => setSearch((prev) => ({ sort: withoutFilters(prev).sort }))}
      >
        <ListHeader
          columns={[
            { label: t('blocks.column.text'), className: col.text },
            { label: t('blocks.column.kind'), className: col.kind },
            { label: t('blocks.column.appliesTo'), className: col.appliesTo },
            { label: t('blocks.column.usedIn'), className: col.usedIn },
            { label: t('blocks.column.expires'), className: col.expires },
          ]}
        />
        <ul>
          {shown.map((b) => (
            <li key={b.id} className="border-b">
              <BlockRow block={b} label={label} />
            </li>
          ))}
        </ul>
      </ListFrame>
    </div>
  )
}

/** Column widths and breakpoints, shared by the header row and every block row so they line up. */
const col = {
  text: 'min-w-0 flex-1',
  kind: 'w-28 shrink-0 max-sm:hidden',
  appliesTo: 'w-52 shrink-0 max-lg:hidden',
  usedIn: 'w-24 shrink-0 text-right max-md:hidden',
  expires: 'w-28 shrink-0 text-right',
}

function BlockRow({ block: b, label }: { block: Block; label: ReturnType<typeof useBlockList>['label'] }) {
  const { t } = useTranslation()
  const products = b.products.length ? b.products.map((p) => label('product', p)).join(', ') : t('rules.allProducts')
  const states = b.states === 'all' ? t('rules.allStates') : b.states.join(', ')

  return (
    // Taller than other list rows: the text wraps in full, because reviewers pick a block by its exact words.
    <Link to="/library/building-blocks/$blockId" params={{ blockId: b.id }} className={cn(listRowClass, 'h-auto min-h-11 items-start py-2.5')}>
      <span className={cn(col.text, 'text-[0.9375rem] leading-snug', b.kind === 'headline' && 'font-semibold', b.kind === 'disclosure' && 'text-muted-foreground')}>
        {b.text}
      </span>
      <BlockKindLabel kind={b.kind} className={cn(col.kind, 'pt-0.5')} />
      <span className={cn(col.appliesTo, 'grid pt-0.5 text-xs text-muted-foreground')}>
        <span className="truncate" title={products}>{products}</span>
        <span className="truncate" title={states}>{states}</span>
      </span>
      <span className={cn(col.usedIn, 'pt-0.5 text-xs text-muted-foreground tabular-nums')}>{t('blocks.usedInCount', { count: b.usedIn })}</span>
      <BlockExpiry expiresAt={b.expiresAt} short className={cn(col.expires, 'pt-0.5 text-xs text-muted-foreground')} />
    </Link>
  )
}
