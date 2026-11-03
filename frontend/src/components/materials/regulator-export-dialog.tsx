import { Download } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SaveError } from '@/components/save-error'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiDownload } from '@/lib/api'
import { useSave } from '@/lib/use-save'
import { CHANNELS, PRODUCTS, STATUSES } from './material-data'
import { useOptionLabel } from './use-option-label'

const ANY = 'any'

/** The Materials list's search and filters (its URL search params, without sort and page), and how many match. */
export type ShownList = { filters: Record<string, string>; count: number }

/** A date as yyyy-mm-dd in UTC, for the date fields. The server reads the range as UTC days. */
function utcDay(offsetDays = 0) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

/**
 * The regulator export (PRD F15): a date range on the version submitted date, optional filters, and optionally
 * only the materials that match the list's search and filters, on every page. The server applies the same
 * filters as the list (listFilters). Internal users only; the server checks it too (PRD section 4).
 */
export function RegulatorExportDialog({ shown, open, onClose }: { shown: ShownList; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {/* Mounted only while open, so each time starts from clean defaults. */}
        {open && <ExportForm shown={shown} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function ExportForm({ shown, onClose }: { shown: ShownList; onClose: () => void }) {
  const { t } = useTranslation()
  const label = useOptionLabel()
  const { pending, error, run } = useSave(onClose)
  const [from, setFrom] = useState(() => utcDay(-90))
  const [to, setTo] = useState(() => utcDay())
  const [channel, setChannel] = useState(ANY)
  const [product, setProduct] = useState(ANY)
  const [status, setStatus] = useState(ANY)
  const [onlyShown, setOnlyShown] = useState(false)
  const listFiltered = Object.keys(shown.filters).length > 0
  const badRange = !!from && !!to && to < from
  const ready = !!from && !!to && !badRange

  const filters = [
    { id: 'export-channel', label: t('materials.export.channel'), value: channel, set: setChannel, options: CHANNELS, key: 'channel' as const },
    { id: 'export-product', label: t('materials.export.product'), value: product, set: setProduct, options: PRODUCTS, key: 'product' as const },
    { id: 'export-status', label: t('materials.export.status'), value: status, set: setStatus, options: STATUSES, key: 'status' as const },
  ]

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready) return
        void run(() =>
          apiDownload('/exports/regulator', {
            dateFrom: from,
            dateTo: to,
            channel: channel === ANY ? undefined : channel,
            product: product === ANY ? undefined : product,
            status: status === ANY ? undefined : status,
            listFilters: onlyShown && listFiltered ? shown.filters : undefined,
          }),
        )
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('materials.export.title')}</DialogTitle>
        <DialogDescription>{t('materials.export.description')}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="export-from">{t('materials.export.from')}</Label>
            <Input id="export-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="export-to">{t('materials.export.to')}</Label>
            <Input id="export-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} required />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{badRange ? t('materials.export.badRange') : t('materials.export.rangeHint')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {filters.map((f) => (
          <div key={f.id} className="grid gap-1.5">
            <Label htmlFor={f.id}>{f.label}</Label>
            <Select value={f.value} onValueChange={f.set}>
              <SelectTrigger id={f.id} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t('materials.export.any')}</SelectItem>
                {f.options.map((o) => <SelectItem key={o} value={o}>{label(f.key, o)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      {/* Only when the list is filtered: otherwise it shows every material anyway. */}
      {listFiltered && (
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox checked={onlyShown} onCheckedChange={(c) => setOnlyShown(c === true)} />
          {t('materials.export.onlyShown', { count: shown.count })}
        </Label>
      )}

      <p className="text-xs text-muted-foreground">{t('materials.export.audited')}</p>

      <SaveError error={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t('materials.export.cancel')}</Button>
        <Button type="submit" disabled={!ready || pending} className="gap-1.5">
          <Download className="size-3.5" aria-hidden="true" />
          {pending ? t('materials.export.running') : t('materials.export.submit')}
        </Button>
      </DialogFooter>
    </form>
  )
}
