import { ArrowRight } from 'lucide-react'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { useProductName } from '@/components/library/product-data'
import { cn } from '@/lib/utils'
import type { ReviewerGroup } from './group-data'
import { formatList, matchesEverything, type RuleConditions } from './routing-data'

/**
 * A routing rule read as one sentence, like a clause in a policy:
 * "When product is Mortgage or HELOC → require Mortgage".
 */
export function RuleSentence({ conditions: c, groupIds, groups, className }: {
  conditions: RuleConditions
  groupIds: string[]
  groups: ReviewerGroup[]
  className?: string
}) {
  const { t } = useTranslation()
  const productName = useProductName()
  const parts: { lead: string; value: string }[] = []
  if (c.products.length) parts.push({ lead: t('settingsRouting.sentence.product'), value: formatList(c.products.map(productName), 'disjunction') })
  if (c.channels.length) parts.push({ lead: t('settingsRouting.sentence.channel'), value: formatList(c.channels.map((ch) => t(`materials.channel.${ch}`)), 'disjunction') })
  if (c.affiliateHistory) parts.push({ lead: t('settingsRouting.sentence.history'), value: t('settingsRouting.sentence.historyValue') })
  else if (c.source) parts.push({ lead: t('settingsRouting.sentence.source'), value: t(`settingsRouting.source.${c.source}`) })
  if (c.nationwide || c.states.length) {
    const places = [...(c.nationwide ? [t('settingsRouting.nationwide')] : []), ...c.states]
    parts.push({ lead: t('settingsRouting.sentence.states'), value: formatList(places, 'disjunction') })
  }

  return (
    <p className={cn('leading-relaxed', className)}>
      {matchesEverything(c) ? (
        <span className="font-medium">{t('settingsRouting.sentence.every')}</span>
      ) : (
        <>
          {t('settingsRouting.sentence.when')}{' '}
          {parts.map((p, i) => (
            <Fragment key={p.lead}>
              {i > 0 && <> {t('settingsRouting.sentence.and')} </>}
              {p.lead} <span className="font-medium">{p.value}</span>
            </Fragment>
          ))}
        </>
      )}
      <ArrowRight className="mx-1.5 inline size-3.5 align-[-2px] text-muted-foreground" aria-label={t('settingsRouting.sentence.then')} />
      {t('settingsRouting.sentence.require')}{' '}
      {groupIds.length ? (
        <span className="inline-flex flex-wrap gap-1 align-middle">
          {groupIds.map((id) => <GroupPill key={id} name={groups.find((g) => g.id === id)?.name} />)}
        </span>
      ) : (
        <span className="text-muted-foreground">{t('settingsRouting.sentence.noGroups')}</span>
      )}
    </p>
  )
}

/** A reviewer group as an outlined pill. */
export function GroupPill({ name, muted }: { name?: string; muted?: boolean }) {
  const { t } = useTranslation()
  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap shadow-[inset_0_0_0_1px_currentColor]',
        muted ? 'text-muted-foreground' : 'bg-primary-soft text-primary-strong',
      )}
    >
      {name ?? t('settingsRouting.unknownGroup')}
    </span>
  )
}
