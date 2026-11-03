import { CalendarClock, MapPin, Package, Shapes } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FilterField, Preset, SortOption } from '@/components/list/list-filters'
import { PRODUCTS } from '@/components/materials/material-data'
import { useOptionLabel } from '@/components/materials/use-option-label'
import { BLOCK_KINDS, EXPIRY_STATES, LICENSED_STATES, type Block, type BlockKind, type ExpiryState } from './block-data'
import { BLOCK_FILTER_KEYS, BLOCK_PRESETS, BLOCK_SORTS, blockValues, type BlockFilterKey } from './block-filters'
import { BlockKindLabel } from './block-meta'

const icons = {
  kind: Shapes,
  product: Package,
  state: MapPin,
  expiry: CalendarClock,
} satisfies Record<BlockFilterKey, unknown>

/** Fields, quick views and sorts for the Building blocks list, with their translated labels. */
export function useBlockList() {
  const { t } = useTranslation()
  const material = useOptionLabel()

  const label = (key: BlockFilterKey, v: string): string => {
    switch (key) {
      case 'kind': return t(`blocks.kind.${v as BlockKind}`)
      case 'product': return material('product', v)
      case 'state': return v
      case 'expiry': return t(`blocks.expiry.${v as ExpiryState}`)
    }
  }
  const fixed: Record<BlockFilterKey, readonly string[]> = {
    kind: BLOCK_KINDS, product: PRODUCTS, state: LICENSED_STATES, expiry: EXPIRY_STATES,
  }
  const render: Partial<Record<BlockFilterKey, (v: string) => React.ReactNode>> = {
    kind: (v) => <BlockKindLabel kind={v as BlockKind} className="text-foreground" />,
  }

  const fields: FilterField<Block>[] = BLOCK_FILTER_KEYS.map((key) => ({
    key,
    label: t(`blocks.field.${key}`),
    icon: icons[key],
    values: (b) => blockValues(b, key),
    options: () => [...fixed[key]],
    optionLabel: (v) => label(key, v),
    renderOption: render[key],
  }))
  const presets: Preset[] = BLOCK_PRESETS.map((p) => ({ key: p.key, label: t(`blocks.preset.${p.key}`), filters: p.filters }))
  const sorts: SortOption[] = BLOCK_SORTS.map((key) => ({ key, label: t(`blocks.sort.${key}`) }))
  return { fields, presets, sorts, defaultSort: 'text', label }
}
