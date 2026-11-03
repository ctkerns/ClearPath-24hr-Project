import { ArrowUpDown, ListFilter, Search, X } from 'lucide-react'
import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { activePreset, filterValues, withoutFilters, type FilterField, type ListSearch, type Preset, type SortOption } from './list-filters'

type SetSearch = (update: (prev: ListSearch) => ListSearch) => void

type ToolbarProps<T> = {
  items: T[]
  fields: FilterField<T>[]
  presets: Preset[]
  sorts: SortOption[]
  defaultSort: string
  search: ListSearch
  setSearch: SetSearch
  searchPlaceholder: string
  /** The page's main action, for example "New submission". It sits at the end of the bar. */
  action?: React.ReactNode
}

/** Quick views, text filter, Filter menu, Sort menu, and the active filter chips. Same on every list screen. */
export function ListToolbar<T>({ items, fields, presets, sorts, defaultSort, search, setSearch, searchPlaceholder, action }: ToolbarProps<T>) {
  const { t } = useTranslation()
  const keys = fields.map((f) => f.key)
  const preset = activePreset(search, presets, keys)
  const sort = search.sort ?? defaultSort

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t('list.views')} className="flex gap-1 overflow-x-auto">
          {presets.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={preset === p.key}
              onClick={() => setSearch((prev) => ({ ...withoutFilters(prev), ...p.filters }))}
              className={cn(
                'h-7 rounded-md border border-transparent px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                'aria-pressed:border-border aria-pressed:bg-muted aria-pressed:text-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 max-sm:w-full">
          <label className="relative max-sm:flex-1">
            <span className="sr-only">{t('list.searchLabel')}</span>
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search.q ?? ''}
              onChange={(e) => setSearch((prev) => ({ ...prev, q: e.target.value || undefined }))}
              placeholder={searchPlaceholder}
              className="h-7 pl-7 text-xs md:text-xs sm:w-52"
            />
          </label>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                <ListFilter className="size-3.5" />
                {t('list.filter')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {fields.map((field) => (
                <DropdownMenuSub key={field.key}>
                  <DropdownMenuSubTrigger className="gap-2">
                    <field.icon className="size-4 text-muted-foreground" strokeWidth={1.75} />
                    {field.label}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-80 min-w-52 overflow-y-auto">
                    <FilterOptionItems field={field} items={items} search={search} setSearch={setSearch} />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                <ArrowUpDown className="size-3.5" />
                <span className="max-sm:sr-only">{t('list.sortButton', { sort: sorts.find((s) => s.key === sort)?.label })}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-xs text-muted-foreground">{t('list.sortBy')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSearch((prev) => ({ ...prev, sort: v === defaultSort ? undefined : v }))}>
                {sorts.map((s) => <DropdownMenuRadioItem key={s.key} value={s.key}>{s.label}</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {action}
        </div>
      </div>

      <ActiveFilters fields={fields} items={items} search={search} setSearch={setSearch} />
    </div>
  )
}

/** Checkbox list of the values for one field, with a count of matching items beside each. */
function FilterOptionItems<T>({ field, items, search, setSearch }: { field: FilterField<T>; items: T[]; search: ListSearch; setSearch: SetSearch }) {
  const selected = filterValues(search, field.key)
  const toggle = (value: string) =>
    setSearch((prev) => {
      const current = filterValues(prev, field.key)
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
      return { ...prev, [field.key]: next.length ? next.join(',') : undefined }
    })
  return field.options(items).map((value) => (
    <DropdownMenuCheckboxItem
      key={value}
      checked={selected.includes(value)}
      onCheckedChange={() => toggle(value)}
      // Keep the menu open, so you can pick more than one value.
      onSelect={(e) => e.preventDefault()}
      className="gap-2"
    >
      {field.renderOption ? field.renderOption(value) : field.optionLabel(value)}
      <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">
        {items.filter((item) => field.values(item).includes(value)).length}
      </span>
    </DropdownMenuCheckboxItem>
  ))
}

/** One chip per filtered field: "Status | is any of | Open, In progress | ×". Click the values to change them. */
function ActiveFilters<T>({ fields, items, search, setSearch }: { fields: FilterField<T>[]; items: T[]; search: ListSearch; setSearch: SetSearch }) {
  const { t } = useTranslation()
  const active = fields.filter((f) => filterValues(search, f.key).length)
  if (!active.length) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {active.map((field) => {
        const values = filterValues(search, field.key)
        const summary = values.length <= 2 ? values.map(field.optionLabel).join(', ') : t('list.valuesCount', { count: values.length })
        return (
          <div key={field.key} className="flex h-7 items-stretch overflow-hidden rounded-md border text-xs">
            <span className="flex items-center gap-1.5 px-2 text-muted-foreground">
              <field.icon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
              {field.label}
            </span>
            <span className="flex items-center border-l px-2 text-muted-foreground">
              {values.length > 1 ? t('list.isAnyOf') : t('list.is')}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center border-l px-2 font-medium hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
                {summary}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-80 min-w-52 overflow-y-auto">
                <FilterOptionItems field={field} items={items} search={search} setSearch={setSearch} />
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              aria-label={t('list.removeFilter', { field: field.label })}
              onClick={() => setSearch((prev) => ({ ...prev, [field.key]: undefined }))}
              className="flex items-center border-l px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )
      })}
      <button
        type="button"
        onClick={() => setSearch(withoutFilters)}
        className="h-7 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {t('list.clearFilters')}
      </button>
    </div>
  )
}
