import { validateListSearch, type ListSearch } from '@/components/list/list-filters'
import type { Material } from './material-data'

// Materials list configuration: filter keys, sorts and quick views. Labels and menus are in use-material-list.tsx.

export const MATERIAL_FILTER_KEYS = ['status', 'live', 'channel', 'product', 'group', 'owner', 'affiliate'] as const
export type MaterialFilterKey = (typeof MATERIAL_FILTER_KEYS)[number]

export const MATERIAL_SORTS = ['updated', 'created', 'expires', 'title'] as const
export type MaterialSort = (typeof MATERIAL_SORTS)[number]

export const validateMaterialsSearch = (raw: Record<string, unknown>) => validateListSearch(raw, MATERIAL_FILTER_KEYS, MATERIAL_SORTS)

/** The value of each filter field for one material. Group is many-valued. */
export function materialValues(m: Material, key: MaterialFilterKey): string[] {
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

export const materialSearchText = (m: Material) => [m.title, m.approvalId, m.affiliate, m.owner]

export function sortMaterials(materials: Material[], search: ListSearch) {
  const list = [...materials]
  switch ((search.sort ?? 'updated') as MaterialSort) {
    case 'updated': return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    // IDs are UUIDv7, which starts with the creation time, so they sort in creation order.
    // TODO: sort by createdAt when the API has it.
    case 'created': return list.sort((a, b) => b.id.localeCompare(a.id))
    case 'title': return list.sort((a, b) => a.title.localeCompare(b.title))
    // Soonest expiry first; materials with no expiry go last.
    case 'expires': return list.sort((a, b) => (a.expiresAt ?? '9999').localeCompare(b.expiresAt ?? '9999'))
  }
}

/** Quick views above the list. Saved views can replace these later. */
export const MATERIAL_PRESETS = [
  { key: 'all', filters: {} },
  { key: 'review', filters: { status: 'submitted,in_review' } },
  { key: 'changes', filters: { status: 'changes_requested,rejected' } },
  { key: 'monitoring', filters: { live: 'unapproved,changed,condition_broken,expired_approval' } },
] as const
