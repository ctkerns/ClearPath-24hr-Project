import type { ComponentType } from 'react'
import { Building2, Package, Radio, UserRound, UsersRound } from 'lucide-react'
import { StatusFieldIcon } from './material-meta'
import { channelIcons, CHANNELS, LIVE_STATUSES, PRODUCTS, STATUSES, type Material } from './material-data'

// Filter, group and sort state for the Materials list. All of it lives in the URL
// (?status=in_review,approved&groupBy=channel), so a filtered list can be shared,
// and later saved as a view.

export const FILTER_KEYS = ['status', 'live', 'channel', 'product', 'group', 'owner', 'affiliate'] as const
export type FilterKey = (typeof FILTER_KEYS)[number]

export const GROUP_BY = ['status', 'live', 'channel', 'product', 'owner', 'none'] as const
export type GroupBy = (typeof GROUP_BY)[number]

export const SORTS = ['updated', 'created', 'expires', 'title'] as const
export type Sort = (typeof SORTS)[number]

export type MaterialsSearch = Partial<Record<FilterKey, string>> & { q?: string; groupBy?: GroupBy; sort?: Sort }

const oneOf = <T extends string>(list: readonly T[], value: unknown) =>
  list.includes(value as T) ? (value as T) : undefined
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined)

/** Keeps only known keys and values, so a bad link shows the plain list instead of an error. */
export function validateMaterialsSearch(raw: Record<string, unknown>): MaterialsSearch {
  const search: MaterialsSearch = {
    q: text(raw.q),
    groupBy: oneOf(GROUP_BY, raw.groupBy),
    sort: oneOf(SORTS, raw.sort),
  }
  for (const key of FILTER_KEYS) search[key] = text(raw[key])
  return search
}

export const filterValues = (search: MaterialsSearch, key: FilterKey) => search[key]?.split(',').filter(Boolean) ?? []

/** The value of each filter field for one material. Group is many-valued. */
export function fieldValues(m: Material, key: FilterKey): string[] {
  switch (key) {
    case 'status': return [m.status]
    case 'live': return [m.liveStatus]
    case 'channel': return [m.channel]
    case 'product': return [m.product]
    case 'group': return m.groups.map((g) => g.name)
    case 'owner': return [m.owner]
    case 'affiliate': return m.affiliate ? [m.affiliate] : []
  }
}

/** Fixed lists come from the PRD. People, groups and affiliates come from the data. */
export function filterOptions(key: FilterKey, materials: Material[]): string[] {
  switch (key) {
    case 'status': return [...STATUSES]
    case 'live': return [...LIVE_STATUSES]
    case 'channel': return [...CHANNELS]
    case 'product': return [...PRODUCTS]
    default: return [...new Set(materials.flatMap((m) => fieldValues(m, key)))].sort()
  }
}

type FieldIcon = ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean | 'true' }>

export const filterIcons: Record<FilterKey, FieldIcon> = {
  status: StatusFieldIcon,
  live: Radio,
  channel: channelIcons.meta,
  product: Package,
  group: UsersRound,
  owner: UserRound,
  affiliate: Building2,
}

export function applyFilters(materials: Material[], search: MaterialsSearch) {
  const q = search.q?.trim().toLowerCase()
  return materials.filter((m) => {
    for (const key of FILTER_KEYS) {
      const wanted = filterValues(search, key)
      if (wanted.length && !fieldValues(m, key).some((v) => wanted.includes(v))) return false
    }
    if (q && ![m.title, m.approvalId, m.affiliate, m.owner].some((v) => v?.toLowerCase().includes(q))) return false
    return true
  })
}

export function sortMaterials(materials: Material[], sort: Sort) {
  const list = [...materials]
  switch (sort) {
    case 'updated': return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    // TODO: sort by createdAt when the API has it. IDs are UUIDv7, which starts with the creation time, so they sort in creation order.
    case 'created': return list.sort((a, b) => b.id.localeCompare(a.id))
    case 'title': return list.sort((a, b) => a.title.localeCompare(b.title))
    // Soonest expiry first; materials with no expiry go last.
    case 'expires': return list.sort((a, b) => (a.expiresAt ?? '9999').localeCompare(b.expiresAt ?? '9999'))
  }
}

/** Quick views above the list. Each one is only a set of filters. Saved views can replace these later. */
export const PRESETS = [
  { key: 'all', filters: {} },
  { key: 'review', filters: { status: 'submitted,in_review' } },
  { key: 'changes', filters: { status: 'changes_requested,rejected' } },
  { key: 'monitoring', filters: { live: 'unapproved,changed,condition_broken,expired_approval' } },
] as const satisfies readonly { key: string; filters: Partial<Record<FilterKey, string>> }[]
export type PresetKey = (typeof PRESETS)[number]['key']

export function activePreset(search: MaterialsSearch): PresetKey | undefined {
  return PRESETS.find((p) =>
    FILTER_KEYS.every((k) => (search[k] ?? '') === ((p.filters as Partial<Record<FilterKey, string>>)[k] ?? '')),
  )?.key
}
