import { CircleDot, Landmark, Package } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FilterField, Preset, SortOption } from '@/components/list/list-filters'
import { PRODUCTS } from '@/components/materials/material-data'
import { useOptionLabel } from '@/components/materials/use-option-label'
import type { Rule } from './rule-data'
import { isUndecided, REG_CHANGE_STATUSES, type RegChange, type RegChangeStatus } from './reg-change-data'
import { REG_CHANGE_FILTER_KEYS, REG_CHANGE_PRESETS, REG_CHANGE_SORTS, regChangeValues, type RegChangeFilterKey } from './reg-change-filters'
import { RegChangeStatusPill } from './reg-change-meta'

const icons = {
  status: CircleDot,
  agency: Landmark,
  product: Package,
} satisfies Record<RegChangeFilterKey, unknown>

/** Fields, quick views and sorts for the Regulatory changes list, with their translated labels. */
export function useRegChangeList(changes: RegChange[], rules: Rule[]) {
  const { t } = useTranslation()
  const material = useOptionLabel()

  const label = (key: RegChangeFilterKey, v: string): string => {
    switch (key) {
      case 'status': return t(`regChanges.status.${v as RegChangeStatus}`)
      case 'agency': return v
      case 'product': return material('product', v)
    }
  }
  const fixed: Partial<Record<RegChangeFilterKey, readonly string[]>> = { status: REG_CHANGE_STATUSES, product: PRODUCTS }

  const fields: FilterField<RegChange>[] = REG_CHANGE_FILTER_KEYS.map((key) => ({
    key,
    label: t(`regChanges.field.${key}`),
    icon: icons[key],
    values: (c) => regChangeValues(c, key, rules),
    options: (items) => [...(fixed[key] ?? [...new Set(items.flatMap((c) => regChangeValues(c, key, rules)))].sort())],
    optionLabel: (v) => label(key, v),
    renderOption: key === 'status' ? (v) => <RegChangeStatusPill status={v as RegChangeStatus} /> : undefined,
  }))
  // The count of changes waiting for a Manager sits in the Waiting label (screen 7), not in a card.
  const waiting = changes.filter(isUndecided).length
  const presets: Preset[] = REG_CHANGE_PRESETS.map((p) => ({
    key: p.key,
    label: p.key === 'waiting' ? t('regChanges.preset.waiting', { count: waiting }) : t(`regChanges.preset.${p.key}`),
    filters: p.filters,
  }))
  const sorts: SortOption[] = REG_CHANGE_SORTS.map((key) => ({ key, label: t(`regChanges.sort.${key}`) }))
  return { fields, presets, sorts, defaultSort: 'effective' }
}
