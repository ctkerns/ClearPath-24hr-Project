import { validateListSearch, type ListSearch } from '@/components/list/list-filters'
import { blockStates, expiryState, type Block } from './block-data'

// Building blocks list configuration: filter keys, sorts and quick views. Labels and menus are in use-block-list.tsx.

export const BLOCK_FILTER_KEYS = ['kind', 'product', 'state', 'expiry'] as const
export type BlockFilterKey = (typeof BLOCK_FILTER_KEYS)[number]

export const BLOCK_SORTS = ['text', 'expires', 'approved', 'used'] as const
export type BlockSort = (typeof BLOCK_SORTS)[number]

export const validateBlocksSearch = (raw: Record<string, unknown>) => validateListSearch(raw, BLOCK_FILTER_KEYS, BLOCK_SORTS)

/**
 * A block with no products, or for all states, is approved for each of them, so it matches every such filter.
 * `allProducts` is every product ID in the Library.
 */
export function blockValues(b: Block, key: BlockFilterKey, licensedStates: readonly string[], allProducts: readonly string[]): string[] {
  switch (key) {
    case 'kind': return [b.kind]
    case 'product': return b.products.length ? b.products : [...allProducts]
    case 'state': return blockStates(b, licensedStates)
    case 'expiry': return [expiryState(b.expiresAt)]
  }
}

export const blockSearchText = (b: Block) => [b.text, b.savedFrom.title, b.approvedBy]

export function sortBlocks(blocks: Block[], search: ListSearch) {
  const list = [...blocks]
  switch ((search.sort ?? 'text') as BlockSort) {
    case 'text': return list.sort((a, b) => a.text.localeCompare(b.text))
    case 'expires': return list.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
    case 'approved': return list.sort((a, b) => b.approvedAt.localeCompare(a.approvedAt))
    case 'used': return list.sort((a, b) => b.usedIn - a.usedIn || a.text.localeCompare(b.text))
  }
}

export const BLOCK_PRESETS = [
  { key: 'all', filters: {} },
  { key: 'headline', filters: { kind: 'headline' } },
  { key: 'claim', filters: { kind: 'claim' } },
  { key: 'disclosure', filters: { kind: 'disclosure' } },
  { key: 'expiring', filters: { expiry: 'expiring,expired' } },
] as const
