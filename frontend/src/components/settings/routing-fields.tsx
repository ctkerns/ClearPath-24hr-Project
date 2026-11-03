import { useTranslation } from 'react-i18next'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { useLicensedStates } from './workspace-data'

// Small form parts shared by the rule editor and the "Test routing" panel.

/** An on/off chip, for picking several products, channels or states. */
export function ToggleChip({ on, onToggle, children, mono, disabled }: {
  on: boolean
  onToggle: () => void
  children: React.ReactNode
  mono?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'h-7 rounded-md border px-2 text-xs hover:border-muted-foreground disabled:pointer-events-none disabled:opacity-50',
        'aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary-strong',
        mono ? 'min-w-10 font-mono' : 'font-medium',
      )}
    >
      {children}
    </button>
  )
}

/** A short row of options where exactly one is picked. */
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-fit rounded-md border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className="h-6 rounded-sm px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground aria-checked:bg-primary-soft aria-checked:text-primary-strong aria-checked:shadow-[inset_0_0_0_1px_currentColor]"
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Nationwide, plus any licensed states. */
export function StatePicker({ nationwide, states, onChange, nationwideHides }: {
  nationwide: boolean
  states: string[]
  onChange: (next: { nationwide: boolean; states: string[] }) => void
  /** In the test panel an item is either nationwide or in some states, so ticking Nationwide hides the states. */
  nationwideHides?: boolean
}) {
  const { t } = useTranslation()
  const licensedStates = useLicensedStates()
  return (
    <div className="grid gap-2">
      <label className="flex w-fit items-center gap-2 text-sm">
        <Checkbox checked={nationwide} onCheckedChange={(c) => onChange({ nationwide: c === true, states })} />
        {t('settingsRouting.nationwide')}
      </label>
      {!(nationwideHides && nationwide) && (
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('settingsRouting.field.states')}>
          {licensedStates.map((s) => {
            const on = states.includes(s)
            return (
              <ToggleChip key={s} mono on={on} onToggle={() => onChange({ nationwide, states: on ? states.filter((x) => x !== s) : [...states, s] })}>
                {s}
              </ToggleChip>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function SectionHeading({ children, id }: { children: React.ReactNode; id?: string }) {
  return <h2 id={id} className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</h2>
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-sm font-medium">{children}</span>
}
