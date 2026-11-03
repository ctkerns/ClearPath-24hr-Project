import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CHANNELS, PRODUCTS } from '@/components/materials/material-data'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatDateTime } from '@/i18n/format'
import type { ReviewerGroup } from './group-data'
import { emptyRule, matchesEverything, useRoutingUpdate, type RoutingRule, type RuleConditions, type RuleInput } from './routing-data'
import { FieldLabel, Segmented, StatePicker, ToggleChip } from './routing-fields'
import { RuleSentence } from './routing-rule-sentence'

/** Add or edit one routing rule. `rule` undefined means a new rule. */
export function RuleDialog({ open, rule, groups, onClose }: {
  open: boolean
  rule?: RoutingRule
  groups: ReviewerGroup[]
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {/* Mounted only while open, so each time starts from the saved rule. */}
        {open && <RuleForm rule={rule} groups={groups} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

type SourceChoice = 'any' | 'internal' | 'affiliate'

function RuleForm({ rule, groups, onClose }: { rule?: RoutingRule; groups: ReviewerGroup[]; onClose: () => void }) {
  const { t } = useTranslation()
  const update = useRoutingUpdate()
  const [value, setValue] = useState<RuleInput>(() =>
    rule ? { name: rule.name, conditions: rule.conditions, requiredGroupIds: rule.requiredGroupIds, note: rule.note } : emptyRule,
  )
  const [tried, setTried] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const c = value.conditions
  const setC = (next: Partial<RuleConditions>) => setValue((v) => ({ ...v, conditions: { ...v.conditions, ...next } }))
  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x])

  const nameMissing = !value.name.trim()
  const groupsMissing = value.requiredGroupIds.length === 0
  const source: SourceChoice = c.affiliateHistory ? 'affiliate' : (c.source ?? 'any')

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        setTried(true)
        if (nameMissing || groupsMissing) return
        const input = { ...value, name: value.name.trim(), note: value.note?.trim() || undefined }
        if (rule) update.edit(rule.id, input)
        else update.create(input)
        onClose()
      }}
    >
      <DialogHeader>
        <DialogTitle>{rule ? t('settingsRouting.editor.editTitle') : t('settingsRouting.editor.newTitle')}</DialogTitle>
        <DialogDescription>{t('settingsRouting.editor.description')}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="rule-name">{t('settingsRouting.field.name')}</Label>
        <Input
          id="rule-name"
          value={value.name}
          onChange={(e) => setValue((v) => ({ ...v, name: e.target.value }))}
          placeholder={t('settingsRouting.editor.namePlaceholder')}
          aria-invalid={tried && nameMissing}
          autoFocus
        />
        {tried && nameMissing && <p className="text-xs font-medium text-destructive">{t('settingsRouting.editor.nameMissing')}</p>}
      </div>

      <fieldset className="grid gap-4 rounded-md border px-3 pt-2 pb-3">
        <legend className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('settingsRouting.editor.when')}</legend>
        <p className="-mt-1 text-xs text-muted-foreground">{t('settingsRouting.editor.whenHelp')}</p>

        <div className="grid gap-1.5">
          <FieldLabel>{t('settingsRouting.field.product')}</FieldLabel>
          <div className="flex flex-wrap gap-1" role="group" aria-label={t('settingsRouting.field.product')}>
            {PRODUCTS.map((p) => (
              <ToggleChip key={p} on={c.products.includes(p)} onToggle={() => setC({ products: toggle(c.products, p) })}>{t(`materials.product.${p}`)}</ToggleChip>
            ))}
          </div>
        </div>

        <div className="grid gap-1.5">
          <FieldLabel>{t('settingsRouting.field.channel')}</FieldLabel>
          <div className="flex flex-wrap gap-1" role="group" aria-label={t('settingsRouting.field.channel')}>
            {CHANNELS.map((ch) => (
              <ToggleChip key={ch} on={c.channels.includes(ch)} onToggle={() => setC({ channels: toggle(c.channels, ch) })}>{t(`materials.channel.${ch}`)}</ToggleChip>
            ))}
          </div>
        </div>

        <div className="grid gap-1.5">
          <FieldLabel>{t('settingsRouting.field.source')}</FieldLabel>
          <Segmented<SourceChoice>
            label={t('settingsRouting.field.source')}
            value={source}
            onChange={(s) => setC({ source: s === 'any' ? undefined : s, affiliateHistory: s === 'affiliate' ? c.affiliateHistory : undefined })}
            options={[
              { value: 'any', label: t('settingsRouting.source.any') },
              { value: 'internal', label: t('settingsRouting.source.internal') },
              { value: 'affiliate', label: t('settingsRouting.source.affiliate') },
            ]}
          />
          {source === 'affiliate' && (
            <label className="mt-1 flex items-start gap-2 text-sm">
              <Checkbox className="mt-0.5" checked={!!c.affiliateHistory} onCheckedChange={(v) => setC({ affiliateHistory: v === true || undefined })} />
              {t('settingsRouting.editor.historyOnly')}
            </label>
          )}
        </div>

        <div className="grid gap-1.5">
          <FieldLabel>{t('settingsRouting.field.states')}</FieldLabel>
          <StatePicker nationwide={!!c.nationwide} states={c.states} onChange={(s) => setC({ nationwide: s.nationwide || undefined, states: s.states })} />
          <p className="text-xs text-muted-foreground">{t('settingsRouting.editor.statesHelp')}</p>
        </div>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-sm font-medium">{t('settingsRouting.editor.require')}</legend>
        <ul className="overflow-hidden rounded-md border">
          {groups.map((g) => (
            <li key={g.id} className="border-b last:border-b-0">
              <label className="flex items-start gap-2.5 px-3 py-2 hover:bg-muted/60">
                <Checkbox
                  className="mt-0.5"
                  checked={value.requiredGroupIds.includes(g.id)}
                  onCheckedChange={() => setValue((v) => ({ ...v, requiredGroupIds: toggle(v.requiredGroupIds, g.id) }))}
                />
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">{g.name}</span>
                  <span className="text-xs text-muted-foreground">{g.description}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {tried && groupsMissing && <p className="text-xs font-medium text-destructive">{t('settingsRouting.editor.groupsMissing')}</p>}
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor="rule-note">{t('settingsRouting.field.note')} <span className="font-normal text-muted-foreground">{t('settingsRouting.optional')}</span></Label>
        <Textarea id="rule-note" rows={2} value={value.note ?? ''} onChange={(e) => setValue((v) => ({ ...v, note: e.target.value }))} placeholder={t('settingsRouting.editor.notePlaceholder')} />
      </div>

      {/* The rule as the list will show it, so the Manager reads back what they wrote. */}
      <div className="grid gap-1 rounded-md bg-muted px-3 py-2.5">
        <p className="text-xs font-semibold">{t('settingsRouting.editor.readsAs')}</p>
        <RuleSentence conditions={c} groupIds={value.requiredGroupIds} groups={groups} className="text-sm" />
        {matchesEverything(c) && <p className="text-xs text-muted-foreground">{t('settingsRouting.editor.everyWarning')}</p>}
      </div>

      <DialogFooter className="items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {rule && (
            confirmDelete ? (
              <>
                <span>{t('settingsRouting.editor.deleteConfirm')}</span>
                <Button type="button" size="sm" variant="destructive" onClick={() => { update.remove(rule.id); onClose() }}>{t('settingsRouting.editor.deleteYes')}</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>{t('settingsRouting.cancel')}</Button>
              </>
            ) : (
              <>
                <Button type="button" size="sm" variant="destructive-outline" onClick={() => setConfirmDelete(true)}>{t('settingsRouting.editor.delete')}</Button>
                <span>{t('settingsRouting.editor.lastChanged', { name: rule.updatedBy, date: formatDateTime(rule.updatedAt) })}</span>
              </>
            )
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t('settingsRouting.cancel')}</Button>
          <Button type="submit">{rule ? t('settingsRouting.editor.save') : t('settingsRouting.editor.add')}</Button>
        </div>
      </DialogFooter>
    </form>
  )
}
