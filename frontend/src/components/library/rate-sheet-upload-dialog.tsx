import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SaveError } from '@/components/save-error'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSave } from '@/lib/use-save'
import { RATE_CSV_COLUMNS, useUploadRateSheet, type RateSheet } from './rate-sheet-data'

/**
 * Upload a new rate sheet as a CSV (PRD F8, Managers only, R3). The server reads and checks every row,
 * so a bad file keeps the dialog open with the line that is wrong.
 */
export function RateSheetUploadDialog({ open, onClose, onUploaded }: {
  open: boolean
  onClose: () => void
  onUploaded: (sheet: RateSheet) => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {/* Mounted only while open, so each time starts empty. */}
        {open && <UploadForm onClose={onClose} onUploaded={onUploaded} />}
      </DialogContent>
    </Dialog>
  )
}

function UploadForm({ onClose, onUploaded }: { onClose: () => void; onUploaded: (sheet: RateSheet) => void }) {
  const { t } = useTranslation()
  const upload = useUploadRateSheet()
  const save = useSave(onClose)
  // The file is read when it is picked, so a file that cannot be read shows at once.
  const [file, setFile] = useState<{ name: string; csv: string }>()
  const [effectiveDate, setEffectiveDate] = useState('')
  const [readError, setReadError] = useState<string>()
  const ready = file && effectiveDate

  const pick = async (picked: File | undefined) => {
    setFile(undefined)
    setReadError(undefined)
    if (!picked) return
    try {
      setFile({ name: picked.name, csv: await picked.text() })
    } catch {
      setReadError(t('rateSheet.upload.readFailed'))
    }
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready || save.pending) return
        void save.run(async () => onUploaded(await upload({ effectiveDate, file: file.name, csv: file.csv })))
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('rateSheet.upload.title')}</DialogTitle>
        <DialogDescription>{t('rateSheet.upload.description')}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="rate-csv">{t('rateSheet.upload.file')}</Label>
        <Input id="rate-csv" type="file" accept=".csv,text/csv" onChange={(e) => void pick(e.target.files?.[0])} autoFocus />
        <p className="text-xs text-muted-foreground">{t('rateSheet.upload.columns', { columns: RATE_CSV_COLUMNS.join(', ') })}</p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="rate-effective">{t('rateSheet.upload.effectiveDate')}</Label>
        <Input id="rate-effective" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="w-44" />
      </div>

      <SaveError error={readError ?? save.error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t('rateSheet.upload.cancel')}</Button>
        <Button type="submit" disabled={!ready || save.pending}>{t('rateSheet.upload.submit')}</Button>
      </DialogFooter>
    </form>
  )
}
