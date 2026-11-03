import { Check, ChevronsUpDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatTimeZoneOffset } from '@/i18n/format'
import { timeZoneNames } from '@/lib/workspace-time'
import { cn } from '@/lib/utils'

/** "America/Los Angeles (GMT-08:00)": the IANA name with its UTC offset now. */
function zoneLabel(t: TFunction, zone: string) {
  return t('settingsWorkspace.timeZone.option', { zone: zone.replaceAll('_', ' '), offset: formatTimeZoneOffset(zone) })
}

/**
 * A searchable list of the IANA time zones the browser knows (Intl.supportedValuesOf), with their offsets now.
 * The saved zone is in the list even when this browser does not know it. Typing "new york" or "GMT-05" finds a zone.
 */
export function TimeZoneSelect({ id, value, onChange, disabled }: {
  id: string
  value: string
  onChange: (zone: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  // Only while open: about 400 zones, each with an offset to format.
  const options = useMemo(() => {
    if (!open) return []
    const names = timeZoneNames()
    return (names.includes(value) ? names : [value, ...names]).map((zone) => ({ zone, label: zoneLabel(t, zone) }))
  }, [open, value, t])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full max-w-sm justify-between font-normal"
        >
          <span className="truncate">{zoneLabel(t, value)}</span>
          <ChevronsUpDown aria-hidden="true" className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-72 p-0">
        <Command>
          <CommandInput placeholder={t('settingsWorkspace.timeZone.search')} />
          <CommandList>
            <CommandEmpty>{t('settingsWorkspace.timeZone.none')}</CommandEmpty>
            {options.map((o) => (
              <CommandItem
                key={o.zone}
                value={o.zone}
                keywords={[o.label]}
                onSelect={() => {
                  onChange(o.zone)
                  setOpen(false)
                }}
              >
                <Check aria-hidden="true" className={cn(o.zone === value ? 'opacity-100' : 'opacity-0')} />
                <span className="truncate">{o.label}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
