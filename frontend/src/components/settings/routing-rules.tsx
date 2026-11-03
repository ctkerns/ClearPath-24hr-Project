import { ChevronDown, ChevronUp, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { ReviewerGroup } from './group-data'
import { useRoutingUpdate, type RoutingRule } from './routing-data'
import { SectionHeading } from './routing-fields'
import { RuleDialog } from './routing-rule-dialog'
import { RuleSentence } from './routing-rule-sentence'

/**
 * The routing rules as a numbered policy: one clause per rule, each read as a sentence.
 * Every enabled rule that matches adds its groups, so the order is for reading only.
 */
export function RoutingRules({ rules, groups, canEdit }: { rules: RoutingRule[]; groups: ReviewerGroup[]; canEdit: boolean }) {
  const { t } = useTranslation()
  const update = useRoutingUpdate()
  // undefined = closed, null = new rule, a rule = edit it.
  const [editing, setEditing] = useState<RoutingRule | null | undefined>(undefined)

  return (
    <section className="grid gap-3" aria-labelledby="routing-rules">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="grid gap-1">
          <SectionHeading id="routing-rules">{t('settingsRouting.rules.heading')}</SectionHeading>
          <p className="text-xs text-muted-foreground">{t('settingsRouting.rules.help')}</p>
        </div>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
            <Plus aria-hidden="true" />{t('settingsRouting.rules.add')}
          </Button>
        )}
      </div>

      {rules.length === 0 ? (
        <p className="rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground">{t('settingsRouting.rules.empty')}</p>
      ) : (
        <ol className="overflow-hidden rounded-lg border">
          {rules.map((r, i) => (
            <li key={r.id} className={cn('grid grid-cols-[1.75rem_minmax(0,1fr)_auto] gap-x-2 border-b px-3 py-2.5 last:border-b-0', !r.enabled && 'bg-muted/40')}>
              <span className="pt-px text-sm text-muted-foreground tabular-nums">{t('settingsRouting.rules.number', { n: i + 1 })}</span>
              <div className={cn('grid min-w-0 gap-0.5', !r.enabled && 'opacity-60')}>
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
                  {r.name}
                  {!r.enabled && <span className="text-xs font-normal text-muted-foreground">{t('settingsRouting.rules.offLabel')}</span>}
                </p>
                <RuleSentence conditions={r.conditions} groupIds={r.requiredGroupIds} groups={groups} className="text-sm" />
                {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
              </div>
              <div className="flex items-start gap-1">
                <Switch
                  className="mt-1 mr-1"
                  checked={r.enabled}
                  disabled={!canEdit}
                  onCheckedChange={(on) => void update.setEnabled(r.id, on).catch(console.error)}
                  aria-label={t('settingsRouting.rules.toggle', { name: r.name })}
                />
                {canEdit && (
                  <>
                    <Button size="icon-xs" variant="ghost" disabled={i === 0} onClick={() => void update.move(r.id, -1).catch(console.error)} aria-label={t('settingsRouting.rules.moveUp', { name: r.name })}>
                      <ChevronUp />
                    </Button>
                    <Button size="icon-xs" variant="ghost" disabled={i === rules.length - 1} onClick={() => void update.move(r.id, 1).catch(console.error)} aria-label={t('settingsRouting.rules.moveDown', { name: r.name })}>
                      <ChevronDown />
                    </Button>
                    <Button size="icon-xs" variant="ghost" onClick={() => setEditing(r)} aria-label={t('settingsRouting.rules.edit', { name: r.name })}>
                      <Pencil />
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      <RuleDialog open={editing !== undefined} rule={editing ?? undefined} groups={groups} onClose={() => setEditing(undefined)} />
    </section>
  )
}
