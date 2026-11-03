import { Checkbox } from '@/components/ui/checkbox'

/** Checkboxes for reviewer groups, two columns on wider screens. */
export function GroupChecklist({ groups, value, onChange, idPrefix }: {
  groups: string[]
  value: string[]
  onChange: (groups: string[]) => void
  idPrefix: string
}) {
  return (
    <div className="grid gap-x-4 gap-y-2 rounded-md border p-3 sm:grid-cols-2">
      {groups.map((g, i) => {
        const id = `${idPrefix}-${i}`
        const checked = value.includes(g)
        return (
          <label key={g} htmlFor={id} className="flex items-center gap-2 text-sm">
            <Checkbox
              id={id}
              checked={checked}
              onCheckedChange={() => onChange(checked ? value.filter((v) => v !== g) : groups.filter((x) => x === g || value.includes(x)))}
            />
            {g}
          </label>
        )
      })}
    </div>
  )
}
