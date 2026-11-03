import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CHANNELS, type Channel, type Product } from '@/components/materials/material-data'
import { ToggleChip } from '@/components/settings/routing-fields'
import { useLicensedStates } from '@/components/settings/workspace-data'
import { Checkbox } from '@/components/ui/checkbox'
import { pickableProducts, useProducts } from './product-data'

// Form parts shared by the rule, disclosure and building block editors (PRD F7, F8, F9).

const toggle = <T,>(list: readonly T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x])

/** A label for a group of chips, with a hint under it. The group is named by the label for screen readers. */
export function ChipField({ id, label, hint, error, children }: {
  id: string
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <span id={`${id}-label`} className="text-sm font-medium">{label}</span>
      <div role="group" aria-labelledby={`${id}-label`} aria-describedby={hint || error ? `${id}-hint` : undefined} className="flex flex-wrap gap-1">
        {children}
      </div>
      {error ? <FieldError id={`${id}-hint`}>{error}</FieldError> : hint && <FieldHint id={`${id}-hint`}>{hint}</FieldHint>}
    </div>
  )
}

/** Products the item applies to. Empty means every product. The chips are the active products, plus any the item has now. */
export function ProductChips({ value, onChange }: { value: Product[]; onChange: (v: Product[]) => void }) {
  const { t } = useTranslation()
  // The products the item had when the form opened stay, so unticking an inactive one does not hide it.
  const [initial] = useState(value)
  const products = pickableProducts(useProducts().data ?? [], [...initial, ...value])
  return (
    <ChipField id="field-products" label={t('rules.editor.products')} hint={t('rules.editor.productsHint')}>
      {products.map((p) => (
        <ToggleChip key={p.id} on={value.includes(p.id)} onToggle={() => onChange(toggle(value, p.id))}>{p.name}</ToggleChip>
      ))}
    </ChipField>
  )
}

/** Channels the rule applies to. Empty means every channel. */
export function ChannelChips({ value, onChange }: { value: Channel[]; onChange: (v: Channel[]) => void }) {
  const { t } = useTranslation()
  return (
    <ChipField id="field-channels" label={t('rules.editor.channels')} hint={t('rules.editor.channelsHint')}>
      {CHANNELS.map((c) => (
        <ToggleChip key={c} on={value.includes(c)} onToggle={() => onChange(toggle(value, c))}>{t(`materials.channel.${c}`)}</ToggleChip>
      ))}
    </ChipField>
  )
}

/**
 * "Every licensed state", or some states. The chips are the licensed states from the Workspace settings,
 * plus any state the item has now that is no longer licensed, so saving never drops it without the Manager seeing it.
 */
export function StatesField({ value, onChange, error }: {
  value: 'all' | string[]
  onChange: (v: 'all' | string[]) => void
  error?: string
}) {
  const { t } = useTranslation()
  const licensed = useLicensedStates()
  const all = value === 'all'
  const picked = all ? [] : value
  const shown = [...licensed, ...picked.filter((s) => !licensed.includes(s))]
  return (
    <div className="grid gap-1.5">
      <span id="field-states-label" className="text-sm font-medium">{t('disclosures.editor.states')}</span>
      <label className="flex w-fit items-center gap-2 text-sm">
        <Checkbox checked={all} onCheckedChange={(c) => onChange(c === true ? 'all' : [])} />
        {t('disclosures.editor.allStates')}
      </label>
      {!all && (
        <div role="group" aria-labelledby="field-states-label" aria-describedby="field-states-hint" aria-invalid={!!error || undefined} className="flex flex-wrap gap-1">
          {shown.map((s) => (
            <ToggleChip key={s} mono on={picked.includes(s)} onToggle={() => onChange(toggle(picked, s))}>{s}</ToggleChip>
          ))}
        </div>
      )}
      {error ? <FieldError id="field-states-hint">{error}</FieldError> : <FieldHint id="field-states-hint">{t('disclosures.editor.statesHint')}</FieldHint>}
    </div>
  )
}

export function FieldHint({ id, children }: { id?: string; children: React.ReactNode }) {
  return <p id={id} className="text-xs text-muted-foreground">{children}</p>
}

/** A problem with one field, under it. The field points here with aria-describedby. */
export function FieldError({ id, children }: { id?: string; children: React.ReactNode }) {
  return <p id={id} className="text-xs font-medium text-destructive">{children}</p>
}
