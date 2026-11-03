import { MapPin, Package } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FilterField, Preset, SortOption } from '@/components/list/list-filters'
import { useOptionLabel } from '@/components/materials/use-option-label'
import type { Disclosure } from './disclosure-data'
import { filterableProducts, useProducts } from './product-data'
import { DISCLOSURE_FILTER_KEYS, DISCLOSURE_PRESETS, DISCLOSURE_SORTS, disclosureValues, type DisclosureFilterKey } from './disclosure-filters'

const icons = { product: Package, state: MapPin } satisfies Record<DisclosureFilterKey, unknown>

/** Fields, quick views and sorts for the Disclosures list, with their translated labels. */
export function useDisclosureList() {
  const { t } = useTranslation()
  const material = useOptionLabel()
  const productIds = filterableProducts(useProducts().data ?? []).map((p) => p.id)

  const label = (key: DisclosureFilterKey, v: string): string =>
    key === 'product' ? material('product', v) : v === 'all' ? t('rules.allStates') : v

  const fields: FilterField<Disclosure>[] = DISCLOSURE_FILTER_KEYS.map((key) => ({
    key,
    label: t(`disclosures.field.${key}`),
    icon: icons[key],
    values: (d) => disclosureValues(d, key, productIds),
    // "All states" first, then each state.
    options: (items) => (key === 'product' ? productIds : [...new Set(items.flatMap((d) => disclosureValues(d, key, productIds)))].sort((a, b) => (a === 'all' ? -1 : b === 'all' ? 1 : a.localeCompare(b)))),
    optionLabel: (v) => label(key, v),
  }))
  const presets: Preset[] = DISCLOSURE_PRESETS.map((p) => ({ key: p.key, label: t(`disclosures.preset.${p.key}`), filters: p.filters }))
  const sorts: SortOption[] = DISCLOSURE_SORTS.map((key) => ({ key, label: t(`disclosures.sort.${key}`) }))
  return { fields, presets, sorts, defaultSort: 'title', label }
}
