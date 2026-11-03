import { Bot, ClipboardCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { CheckLayer } from './rule-data'

/** "Code check" or "AI check", with the same icons that the history uses for these system actors. */
export function CheckLayerTag({ layer, className }: { layer: CheckLayer; className?: string }) {
  const { t } = useTranslation()
  const Icon = layer === 'code' ? ClipboardCheck : Bot
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-muted-foreground', className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {t(`rules.layer.${layer}`)}
    </span>
  )
}

/** A small outlined tag for a rule that a regulatory change will affect. */
export function PendingChangeTag({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <span className={cn('shrink-0 rounded-sm bg-info-soft px-1.5 py-0.5 text-[11px] font-semibold text-info shadow-[inset_0_0_0_1px_currentColor]', className)}>
      {t('rules.pendingChange')}
    </span>
  )
}
