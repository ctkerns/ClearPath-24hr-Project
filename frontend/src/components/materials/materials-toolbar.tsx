import { ListFilter, Search, SlidersHorizontal, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { ChannelIcon, LiveStatusTag, PersonAvatar } from './material-meta'
import type { Channel, LiveStatus, Material } from './material-data'
import { useOptionLabel } from './use-option-label'
import { StatusPill, type MaterialStatus } from '@/components/ui/status-pill'
import {
  activePreset,
  FILTER_KEYS,
  fieldValues,
  filterIcons,
  filterOptions,
  filterValues,
  GROUP_BY,
  PRESETS,
  SORTS,
  type FilterKey,
  type GroupBy,
  type MaterialsSearch,
  type Sort,
} from './material-filters'

type SetSearch = (update: (prev: MaterialsSearch) => MaterialsSearch) => void

/** How a filter value looks inside the menus: the same pill or icon that the rows use. */
function OptionContent({ field, value }: { field: FilterKey; value: string }) {
  const label = useOptionLabel()
  if (field === 'status') return <StatusPill status={value as MaterialStatus} />
  if (field === 'live') return <LiveStatusTag status={value as LiveStatus} className="px-0" />
  if (field === 'channel') return <><ChannelIcon channel={value as Channel} />{label(field, value)}</>
  if (field === 'owner') return <><PersonAvatar name={value} className="size-5 text-[9px]" />{value}</>
  return <>{label(field, value)}</>
}

/** Checkbox list of the values for one field, with a count of matching materials beside each. */
function FilterOptionItems({ field, materials, search, setSearch }: { field: FilterKey; materials: Material[]; search: MaterialsSearch; setSearch: SetSearch }) {
  const selected = filterValues(search, field)
  const toggle = (value: string) =>
    setSearch((prev) => {
      const current = filterValues(prev, field)
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
      return { ...prev, [field]: next.length ? next.join(',') : undefined }
    })
  return filterOptions(field, materials).map((value) => (
    <DropdownMenuCheckboxItem
      key={value}
      checked={selected.includes(value)}
      onCheckedChange={() => toggle(value)}
      // Keep the menu open, so you can pick more than one value.
      onSelect={(e) => e.preventDefault()}
      className="gap-2"
    >
      <OptionContent field={field} value={value} />
      <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">
        {materials.filter((m) => fieldValues(m, field).includes(value)).length}
      </span>
    </DropdownMenuCheckboxItem>
  ))
}

export function MaterialsToolbar({ materials, search, setSearch }: { materials: Material[]; search: MaterialsSearch; setSearch: SetSearch }) {
  const { t } = useTranslation()
  const preset = activePreset(search)
  const groupBy = search.groupBy ?? 'status'
  const sort = search.sort ?? 'updated'

  return (
    <div className="grid gap-2">
      {/* Quick views, then search, filter and display controls. */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t('materials.views')} className="flex gap-1 overflow-x-auto">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={preset === p.key}
              onClick={() =>
                setSearch((prev) => ({
                  ...Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])),
                  ...p.filters,
                  q: prev.q,
                  groupBy: prev.groupBy,
                  sort: prev.sort,
                }))
              }
              className={cn(
                'h-7 rounded-md border border-transparent px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                'aria-pressed:border-border aria-pressed:bg-muted aria-pressed:text-foreground',
              )}
            >
              {t(`materials.preset.${p.key}`)}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 max-sm:w-full">
          <label className="relative max-sm:flex-1">
            <span className="sr-only">{t('materials.searchLabel')}</span>
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search.q ?? ''}
              onChange={(e) => setSearch((prev) => ({ ...prev, q: e.target.value || undefined }))}
              placeholder={t('materials.searchPlaceholder')}
              className="h-7 pl-7 text-xs md:text-xs sm:w-52"
            />
          </label>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                <ListFilter className="size-3.5" />
                {t('materials.filter')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {FILTER_KEYS.map((key) => {
                const Icon = filterIcons[key]
                return (
                  <DropdownMenuSub key={key}>
                    <DropdownMenuSubTrigger className="gap-2">
                      <Icon className="size-4 text-muted-foreground" strokeWidth={1.75} />
                      {t(`materials.field.${key}`)}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-80 min-w-52 overflow-y-auto">
                      <FilterOptionItems field={key} materials={materials} search={search} setSearch={setSearch} />
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                <SlidersHorizontal className="size-3.5" />
                <span className="max-sm:sr-only">{t('materials.display')}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-xs text-muted-foreground">{t('materials.groupBy')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={groupBy} onValueChange={(v) => setSearch((prev) => ({ ...prev, groupBy: v === 'status' ? undefined : (v as GroupBy) }))}>
                {GROUP_BY.map((g) => (
                  <DropdownMenuRadioItem key={g} value={g}>{t(`materials.groupByOption.${g}`)}</DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">{t('materials.orderBy')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSearch((prev) => ({ ...prev, sort: v === 'updated' ? undefined : (v as Sort) }))}>
                {SORTS.map((s) => (
                  <DropdownMenuRadioItem key={s} value={s}>{t(`materials.sort.${s}`)}</DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ActiveFilters materials={materials} search={search} setSearch={setSearch} />
    </div>
  )
}

/** One chip per filtered field: "Status | is any of | In review, Submitted | ×". Click the values to change them. */
function ActiveFilters({ materials, search, setSearch }: { materials: Material[]; search: MaterialsSearch; setSearch: SetSearch }) {
  const { t } = useTranslation()
  const label = useOptionLabel()
  const active = FILTER_KEYS.filter((k) => filterValues(search, k).length)
  if (!active.length) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {active.map((key) => {
        const values = filterValues(search, key)
        const Icon = filterIcons[key]
        const summary = values.length <= 2
          ? values.map((v) => label(key, v)).join(', ')
          : t('materials.valuesCount', { count: values.length })
        return (
          <div key={key} className="flex h-7 items-stretch overflow-hidden rounded-md border text-xs">
            <span className="flex items-center gap-1.5 px-2 text-muted-foreground">
              <Icon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
              {t(`materials.field.${key}`)}
            </span>
            <span className="flex items-center border-l px-2 text-muted-foreground">
              {values.length > 1 ? t('materials.isAnyOf') : t('materials.is')}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center border-l px-2 font-medium hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
                {summary}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-80 min-w-52 overflow-y-auto">
                <FilterOptionItems field={key} materials={materials} search={search} setSearch={setSearch} />
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              aria-label={t('materials.removeFilter', { field: t(`materials.field.${key}`) })}
              onClick={() => setSearch((prev) => ({ ...prev, [key]: undefined }))}
              className="flex items-center border-l px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )
      })}
      <button
        type="button"
        onClick={() => setSearch((prev) => ({ q: prev.q, groupBy: prev.groupBy, sort: prev.sort }))}
        className="h-7 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {t('materials.clearFilters')}
      </button>
    </div>
  )
}
