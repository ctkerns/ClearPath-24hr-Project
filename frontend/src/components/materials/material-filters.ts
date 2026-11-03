import { validatePagedSearch } from '@/components/list/list-filters'
import { CHANNELS, LIVE_STATUSES, PRODUCTS, STATUSES } from './material-data'

// Materials list configuration: filter keys, sorts and quick views. Labels and menus are in use-material-list.tsx.
// The server filters, searches, sorts and pages (GET /api/materials, backend/src/app/material_list.py):
// these keys and values are its query parameters.

export const MATERIAL_FILTER_KEYS = ['status', 'live', 'channel', 'product', 'group', 'owner', 'affiliate'] as const
export type MaterialFilterKey = (typeof MATERIAL_FILTER_KEYS)[number]

export const MATERIAL_SORTS = ['updated', 'created', 'expires', 'title'] as const
export type MaterialSort = (typeof MATERIAL_SORTS)[number]

/** The fixed values from the PRD. People, groups and affiliates come from the server's counts. */
export const MATERIAL_FIXED: Partial<Record<MaterialFilterKey, readonly string[]>> = {
  status: STATUSES,
  live: LIVE_STATUSES,
  channel: CHANNELS,
  product: PRODUCTS,
}

export const validateMaterialsSearch = (raw: Record<string, unknown>) =>
  validatePagedSearch(raw, MATERIAL_FILTER_KEYS, MATERIAL_SORTS, MATERIAL_FIXED)

/** Quick views above the list. Saved views can replace these later. */
export const MATERIAL_PRESETS = [
  { key: 'all', filters: {} },
  { key: 'review', filters: { status: 'submitted,in_review' } },
  { key: 'changes', filters: { status: 'changes_requested,rejected' } },
  { key: 'monitoring', filters: { live: 'unapproved,changed,condition_broken,expired_approval' } },
] as const
