import { Heading, MousePointerClick, Quote, ScrollText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatDate } from '@/i18n/format'
import { cn } from '@/lib/utils'
import { expiryState, type BlockKind } from './block-data'

const kindIcons = { headline: Heading, claim: Quote, cta: MousePointerClick, disclosure: ScrollText } satisfies Record<BlockKind, unknown>

/** "Headline", "Claim", "Call to action" or "Disclosure", with a quiet icon, like a content type in a CMS. */
export function BlockKindLabel({ kind, className }: { kind: BlockKind; className?: string }) {
  const { t } = useTranslation()
  const Icon = kindIcons[kind]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-muted-foreground', className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {t(`blocks.kind.${kind}`)}
    </span>
  )
}

/** The expiry date, amber within 30 days and red once passed, the same as the materials list. */
export function BlockExpiry({ expiresAt, short, className }: { expiresAt: string; short?: boolean; className?: string }) {
  const { t } = useTranslation()
  const state = expiryState(expiresAt)
  const date = formatDate(expiresAt, short ? { month: 'short', day: 'numeric', year: 'numeric' } : undefined)
  return (
    <span
      title={t('blocks.expiresOn', { date: formatDate(expiresAt) })}
      className={cn('tabular-nums', className, state === 'expired' && 'font-medium text-risk-high', state === 'expiring' && 'font-medium text-risk-medium')}
    >
      {state === 'expired' ? t('blocks.expiredOn', { date }) : date}
    </span>
  )
}
