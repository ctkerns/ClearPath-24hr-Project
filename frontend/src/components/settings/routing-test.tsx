import { Check, FlaskConical, Minus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CHANNELS, PRODUCTS, type Channel, type Product } from '@/components/materials/material-data'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { ReviewerGroup } from './group-data'
import { evaluateRouting, formatList, type Miss, type RoutingInput, type RoutingRule, type RuleSource } from './routing-data'
import { FieldLabel, Segmented, StatePicker } from './routing-fields'
import { GroupPill } from './routing-rule-sentence'

/**
 * "Test routing": pick an example item and see which groups it would need, and which rule asked for each.
 * It runs the rules as they stand now, including unsaved-to-server demo edits, so a Manager can check a change.
 */
export function RoutingTest({ rules, groups, lighterPathGroup }: { rules: RoutingRule[]; groups: ReviewerGroup[]; lighterPathGroup?: ReviewerGroup }) {
  const { t } = useTranslation()
  const [v, setV] = useState<RoutingInput>({ product: 'mortgage', channel: 'meta', source: 'internal', affiliateHistory: false, nationwide: false, states: ['CA'] })
  const set = (next: Partial<RoutingInput>) => setV((prev) => ({ ...prev, ...next }))
  const defaultGroup = groups.find((g) => g.isDefault)
  const hasStates = v.nationwide || v.states.length > 0
  const result = hasStates ? evaluateRouting(rules, defaultGroup?.id, v) : undefined
  const nameOf = (id: string) => groups.find((g) => g.id === id)?.name
  const ruleNumber = (id: string) => rules.findIndex((r) => r.id === id) + 1

  return (
    <section className="grid gap-4 rounded-lg border bg-card p-4" aria-labelledby="routing-test">
      <div className="grid gap-1">
        <h2 id="routing-test" className="flex items-center gap-1.5 text-sm font-semibold">
          <FlaskConical className="size-4 text-primary" aria-hidden="true" />{t('settingsRouting.test.heading')}
        </h2>
        <p className="text-xs text-muted-foreground">{t('settingsRouting.test.help')}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <FieldLabel>{t('settingsRouting.field.product')}</FieldLabel>
          <Select value={v.product} onValueChange={(p) => set({ product: p as Product })}>
            <SelectTrigger size="sm" className="w-full" aria-label={t('settingsRouting.field.product')}><SelectValue /></SelectTrigger>
            <SelectContent>{PRODUCTS.map((p) => <SelectItem key={p} value={p}>{t(`materials.product.${p}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <FieldLabel>{t('settingsRouting.field.channel')}</FieldLabel>
          <Select
            value={v.channel}
            // Affiliate pages come from affiliates, so the source follows the channel.
            onValueChange={(ch) => set({ channel: ch as Channel, ...(ch === 'affiliate' ? { source: 'affiliate' as const } : {}) })}
          >
            <SelectTrigger size="sm" className="w-full" aria-label={t('settingsRouting.field.channel')}><SelectValue /></SelectTrigger>
            <SelectContent>{CHANNELS.map((ch) => <SelectItem key={ch} value={ch}>{t(`materials.channel.${ch}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-1.5">
        <FieldLabel>{t('settingsRouting.field.source')}</FieldLabel>
        <Segmented<RuleSource>
          label={t('settingsRouting.field.source')}
          value={v.source}
          onChange={(s) => set({ source: s, affiliateHistory: s === 'affiliate' && v.affiliateHistory })}
          options={[
            { value: 'internal', label: t('settingsRouting.source.internal') },
            { value: 'affiliate', label: t('settingsRouting.source.affiliate') },
          ]}
        />
        {v.source === 'affiliate' && (
          <label className="mt-1 flex items-start gap-2 text-xs">
            <Checkbox className="mt-px" checked={v.affiliateHistory} onCheckedChange={(c) => set({ affiliateHistory: c === true })} />
            {t('settingsRouting.test.history')}
          </label>
        )}
      </div>

      <div className="grid gap-1.5">
        <FieldLabel>{t('settingsRouting.field.states')}</FieldLabel>
        <StatePicker nationwideHides nationwide={v.nationwide} states={v.states} onChange={(s) => set(s)} />
      </div>

      <div className="grid gap-3 border-t pt-3" aria-live="polite">
        {!result ? (
          <p className="text-sm text-muted-foreground">{t('settingsRouting.test.pickStates')}</p>
        ) : (
          <>
            <div className="grid gap-2">
              <p className="text-xs font-semibold">{t('settingsRouting.test.required', { count: result.required.length })}</p>
              {result.required.length === 0 ? (
                <p className="text-sm text-destructive">{t('settingsRouting.test.nobody')}</p>
              ) : (
                <ul className="grid gap-1.5">
                  {result.required.map((g) => (
                    <li key={g.groupId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <GroupPill name={nameOf(g.groupId)} />
                      <span className="text-xs text-muted-foreground">
                        {g.ruleIds.length
                          ? t('settingsRouting.test.because', { rules: formatList(g.ruleIds.map((id) => t('settingsRouting.rules.number', { n: ruleNumber(id) })), 'conjunction') })
                          : t('settingsRouting.test.becauseDefault')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">{t('settingsRouting.test.approval')}</p>
            </div>

            <div className="grid gap-1.5">
              <p className="text-xs font-semibold">{t('settingsRouting.test.byRule')}</p>
              <ol className="grid gap-1">
                {result.results.map((r, i) => (
                  <li key={r.rule.id} className={cn('grid grid-cols-[1rem_1.5rem_minmax(0,1fr)] items-baseline gap-x-1 text-xs', r.outcome !== 'matched' && 'text-muted-foreground')}>
                    {r.outcome === 'matched'
                      ? <Check className="size-3.5 self-center text-risk-low" aria-label={t('settingsRouting.test.matched')} />
                      : <Minus className="size-3.5 self-center" aria-label={t('settingsRouting.test.notMatched')} />}
                    <span className="tabular-nums">{t('settingsRouting.rules.number', { n: i + 1 })}</span>
                    <span className="min-w-0">
                      <span className={cn(r.outcome === 'matched' && 'font-medium text-foreground')}>{r.rule.name}</span>
                      {r.outcome === 'off' && <> · {t('settingsRouting.test.off')}</>}
                      {r.miss && <> · <MissText miss={r.miss} /></>}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            <p className="rounded-md bg-muted px-2.5 py-2 text-xs">
              {t('settingsRouting.test.lighter', { group: lighterPathGroup?.name ?? t('settingsRouting.unknownGroup') })}
            </p>
          </>
        )}
      </div>
    </section>
  )
}

/** Why a rule was skipped, in the item's own terms: "product is Savings". */
function MissText({ miss }: { miss: Miss }) {
  const { t } = useTranslation()
  switch (miss.field) {
    case 'product':
      return <>{t('settingsRouting.miss.product', { value: t(`materials.product.${miss.value}`) })}</>
    case 'channel':
      return <>{t('settingsRouting.miss.channel', { value: t(`materials.channel.${miss.value}`) })}</>
    case 'source':
      return <>{t('settingsRouting.miss.source', { value: t(`settingsRouting.source.${miss.value}`) })}</>
    case 'history':
      return <>{t('settingsRouting.miss.history')}</>
    case 'states':
      return <>{t('settingsRouting.miss.states')}</>
  }
}
