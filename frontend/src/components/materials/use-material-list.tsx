import { Building2, Megaphone, Package, Radio, UserRound, UsersRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FilterField, Preset, SortOption } from '@/components/list/list-filters'
import { StatusPill, type MaterialStatus } from '@/components/ui/status-pill'
import { CHANNELS, LIVE_STATUSES, PRODUCTS, STATUSES, type Channel, type LiveStatus, type Material } from './material-data'
import { MATERIAL_FILTER_KEYS, MATERIAL_PRESETS, MATERIAL_SORTS, materialValues, type MaterialFilterKey } from './material-filters'
import { ChannelIcon, LiveStatusTag, PersonAvatar, StatusFieldIcon } from './material-meta'
import { useOptionLabel } from './use-option-label'

const icons = {
  status: StatusFieldIcon,
  live: Radio,
  channel: Megaphone,
  product: Package,
  group: UsersRound,
  owner: UserRound,
  affiliate: Building2,
} satisfies Record<MaterialFilterKey, unknown>

/** Fields, quick views and sorts for the Materials list, with their translated labels. */
export function useMaterialList() {
  const { t } = useTranslation()
  const label = useOptionLabel()

  const fixed: Partial<Record<MaterialFilterKey, readonly string[]>> = { status: STATUSES, live: LIVE_STATUSES, channel: CHANNELS, product: PRODUCTS }
  const render: Partial<Record<MaterialFilterKey, (v: string) => React.ReactNode>> = {
    status: (v) => <StatusPill status={v as MaterialStatus} />,
    live: (v) => <LiveStatusTag status={v as LiveStatus} className="px-0" />,
    channel: (v) => <><ChannelIcon channel={v as Channel} />{label('channel', v)}</>,
    owner: (v) => <><PersonAvatar name={v} className="size-5 text-[9px]" />{v}</>,
  }

  const fields: FilterField<Material>[] = MATERIAL_FILTER_KEYS.map((key) => ({
    key,
    label: t(`materials.field.${key}`),
    icon: icons[key],
    values: (m) => materialValues(m, key),
    // Fixed lists come from the PRD. People, groups and affiliates come from the data.
    options: (items) => [...(fixed[key] ?? [...new Set(items.flatMap((m) => materialValues(m, key)))].sort())],
    optionLabel: (v) => label(key, v),
    renderOption: render[key],
  }))
  const presets: Preset[] = MATERIAL_PRESETS.map((p) => ({ key: p.key, label: t(`materials.preset.${p.key}`), filters: p.filters }))
  const sorts: SortOption[] = MATERIAL_SORTS.map((key) => ({ key, label: t(`materials.sort.${key}`) }))
  return { fields, presets, sorts, defaultSort: 'updated' }
}
