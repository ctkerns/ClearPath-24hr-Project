import { Building2, CalendarClock, Megaphone, ScanEye, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FilterField, Preset, SortOption } from '@/components/list/list-filters'
import { CHANNELS, type Channel } from '@/components/materials/material-data'
import { ChannelIcon, PersonAvatar, StatusFieldIcon } from '@/components/materials/material-meta'
import { SeverityLabel, type RiskLevel } from '@/components/ui/risk-tag'
import { DUE_BUCKETS, ISSUE_SOURCES, ISSUE_STATUSES, SEVERITIES, type DueBucket, type Issue, type IssueSource, type IssueStatus } from './issue-data'
import { ISSUE_FILTER_KEYS, ISSUE_PRESETS, ISSUE_SORTS, issueValues, type IssueFilterKey } from './issue-filters'
import { IssueStatusPill, SeverityFieldIcon } from './issue-meta'

const icons = {
  status: StatusFieldIcon,
  severity: SeverityFieldIcon,
  due: CalendarClock,
  source: ScanEye,
  channel: Megaphone,
  owner: UserRound,
  affiliate: Building2,
} satisfies Record<IssueFilterKey, unknown>

/** Fields, quick views and sorts for the Issues list, with their translated labels. */
export function useIssueList() {
  const { t } = useTranslation()

  const label = (key: IssueFilterKey, v: string): string => {
    switch (key) {
      case 'status': return t(`issues.status.${v as IssueStatus}`)
      case 'severity': return t(`level.${v as RiskLevel}`)
      case 'due': return t(`issues.due.${v as DueBucket}`)
      case 'source': return t(`issues.source.${v as IssueSource}`)
      case 'channel': return t(`materials.channel.${v as Channel}`)
      default: return v
    }
  }
  const fixed: Partial<Record<IssueFilterKey, readonly string[]>> = {
    status: ISSUE_STATUSES, severity: SEVERITIES, due: DUE_BUCKETS, source: ISSUE_SOURCES, channel: CHANNELS,
  }
  const render: Partial<Record<IssueFilterKey, (v: string) => React.ReactNode>> = {
    status: (v) => <IssueStatusPill status={v as IssueStatus} />,
    severity: (v) => <SeverityLabel level={v as RiskLevel} />,
    channel: (v) => <><ChannelIcon channel={v as Channel} />{label('channel', v)}</>,
    owner: (v) => <><PersonAvatar name={v} className="size-5 text-[9px]" />{v}</>,
  }

  const fields: FilterField<Issue>[] = ISSUE_FILTER_KEYS.map((key) => ({
    key,
    label: t(`issues.field.${key}`),
    icon: icons[key],
    values: (i) => issueValues(i, key),
    options: (items) => [...(fixed[key] ?? [...new Set(items.flatMap((i) => issueValues(i, key)))].sort())],
    optionLabel: (v) => label(key, v),
    renderOption: render[key],
  }))
  const presets: Preset[] = ISSUE_PRESETS.map((p) => ({ key: p.key, label: t(`issues.preset.${p.key}`), filters: p.filters }))
  const sorts: SortOption[] = ISSUE_SORTS.map((key) => ({ key, label: t(`issues.sort.${key}`) }))
  return { fields, presets, sorts, defaultSort: 'due', label }
}
