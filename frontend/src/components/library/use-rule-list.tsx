import { ClipboardCheck, Landmark, MapPin, Megaphone, Package, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FilterField, Preset, SortOption } from '@/components/list/list-filters'
import { SeverityFieldIcon } from '@/components/issues/issue-meta'
import { CHANNELS, type Channel } from '@/components/materials/material-data'
import { ChannelIcon } from '@/components/materials/material-meta'
import { useOptionLabel } from '@/components/materials/use-option-label'
import { SeverityLabel, type RiskLevel } from '@/components/ui/risk-tag'
import { filterableProducts, useProducts } from './product-data'
import { CHECK_LAYERS, RULE_KINDS, type CheckLayer, type Rule, type RuleKind } from './rule-data'
import { RULE_FILTER_KEYS, RULE_PRESETS, RULE_SORTS, ruleValues, type RuleFilterKey } from './rule-filters'
import { CheckLayerTag } from './rule-meta'

/** All states first, then Federal, then each state. */
const jurisdictionOrder = (v: string) => (v === 'all' ? 0 : v === 'federal' ? 1 : 2)

const icons = {
  kind: Landmark,
  severity: SeverityFieldIcon,
  layer: ClipboardCheck,
  jurisdiction: MapPin,
  product: Package,
  channel: Megaphone,
  change: RefreshCw,
} satisfies Record<RuleFilterKey, unknown>

/** Fields, quick views and sorts for the Rules list, with their translated labels. */
export function useRuleList() {
  const { t } = useTranslation()
  const material = useOptionLabel()
  const productIds = filterableProducts(useProducts().data ?? []).map((p) => p.id)

  const label = (key: RuleFilterKey, v: string): string => {
    switch (key) {
      case 'kind': return t(`rules.kind.${v as RuleKind}`)
      case 'severity': return t(`level.${v as RiskLevel}`)
      case 'layer': return t(`rules.layer.${v as CheckLayer}`)
      case 'jurisdiction': return v === 'federal' ? t('rules.federal') : v === 'all' ? t('rules.allStates') : v
      case 'product': return material('product', v)
      case 'channel': return material('channel', v)
      case 'change': return t(`rules.change.${v as 'pending' | 'current'}`)
    }
  }
  const fixed: Partial<Record<RuleFilterKey, readonly string[]>> = {
    kind: RULE_KINDS, severity: ['high', 'medium', 'low'], layer: CHECK_LAYERS, product: productIds, channel: CHANNELS, change: ['pending', 'current'],
  }
  const render: Partial<Record<RuleFilterKey, (v: string) => React.ReactNode>> = {
    severity: (v) => <SeverityLabel level={v as RiskLevel} />,
    layer: (v) => <CheckLayerTag layer={v as CheckLayer} className="text-foreground" />,
    channel: (v) => <><ChannelIcon channel={v as Channel} />{label('channel', v)}</>,
  }

  const fields: FilterField<Rule>[] = RULE_FILTER_KEYS.map((key) => ({
    key,
    label: t(`rules.field.${key}`),
    icon: icons[key],
    values: (r) => ruleValues(r, key, productIds),
    options: (items) => [...(fixed[key] ?? [...new Set(items.flatMap((r) => ruleValues(r, key, productIds)))].sort((a, b) => jurisdictionOrder(a) - jurisdictionOrder(b) || a.localeCompare(b)))],
    optionLabel: (v) => label(key, v),
    renderOption: render[key],
  }))
  const presets: Preset[] = RULE_PRESETS.map((p) => ({ key: p.key, label: t(`rules.preset.${p.key}`), filters: p.filters }))
  const sorts: SortOption[] = RULE_SORTS.map((key) => ({ key, label: t(`rules.sort.${key}`) }))
  return { fields, presets, sorts, defaultSort: 'title', label }
}
