import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Product } from '@/components/materials/material-data'
import { SaveError } from '@/components/save-error'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useSave } from '@/lib/use-save'
import { FlagPreview } from './affected-materials'
import { useDisclosureDependents } from './impact-data'
import { disclosureIdTaken, useDisclosureUpdate, useDisclosures, type Disclosure, type DisclosureInput } from './disclosure-data'
import { dateFromToday, focusFirstInvalid, MAX_LONG, MAX_NOTE, MAX_SHORT, TEXT_ID } from './form-utils'
import { FieldError, FieldHint, ProductChips, StatesField } from './library-fields'

/**
 * Add a disclosure, or edit one as a new version (PRD F8; Managers only, R3).
 * Each version keeps its full text, so the page can show what changed.
 */
export function DisclosureFormDialog({ disclosure, open, onClose, onCreated }: {
  /** The disclosure to edit. Leave it out to add one. */
  disclosure?: Disclosure
  open: boolean
  onClose: () => void
  onCreated?: (disclosure: Disclosure) => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {/* Mounted only while open, so each time starts from the saved disclosure. */}
        {open && <DisclosureForm disclosure={disclosure} onClose={onClose} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  )
}

function DisclosureForm({ disclosure: old, onClose, onCreated }: {
  disclosure?: Disclosure
  onClose: () => void
  onCreated?: (disclosure: Disclosure) => void
}) {
  const { t } = useTranslation()
  const disclosures = useDisclosures()
  const update = useDisclosureUpdate()
  const save = useSave(onClose)
  const [id, setId] = useState('')
  const [title, setTitle] = useState(old?.title ?? '')
  const [text, setText] = useState(old?.text ?? '')
  const [placement, setPlacement] = useState(old?.placement ?? '')
  const [products, setProducts] = useState<Product[]>(old?.products ?? [])
  const [states, setStates] = useState<'all' | string[]>(old?.states ?? 'all')
  const [effectiveDate, setEffectiveDate] = useState(old?.effectiveDate ?? dateFromToday(0))
  const [note, setNote] = useState('')
  const [tried, setTried] = useState(false)
  // A new version flags the approved materials that use this disclosure (F7, F15). The server previews them.
  const preview = useDisclosureDependents(old?.id, effectiveDate || undefined)

  const required = t('rules.editor.required')
  const errors = {
    id: old ? undefined
      : !id.trim() ? required
      : !TEXT_ID.test(id.trim()) ? t('rules.editor.idInvalid')
      : disclosureIdTaken(disclosures.data ?? [], id) ? t('disclosures.editor.idTaken')
      : undefined,
    title: title.trim() ? undefined : required,
    text: text.trim() ? undefined : required,
    placement: placement.trim() ? undefined : required,
    states: states === 'all' || states.length > 0 ? undefined : t('disclosures.editor.statesMissing'),
    effectiveDate: effectiveDate ? undefined : required,
    note: note.trim() ? undefined : required,
  }
  const ready = Object.values(errors).every((e) => !e)
  // A taken ID shows as the Manager types. The rest shows after Save.
  const show = (key: keyof typeof errors) => (tried || (key === 'id' && id.trim()) ? errors[key] : undefined)

  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        setTried(true)
        if (!ready) focusFirstInvalid(e.currentTarget)
        if (!ready || save.pending) return
        const input: DisclosureInput = {
          title: title.trim(),
          text: text.trim(),
          products,
          states,
          placement: placement.trim(),
          effectiveDate,
          note: note.trim(),
        }
        void save.run(async () => {
          if (old) await update.edit(old.id, input)
          else onCreated?.(await update.create(id.trim(), input))
        })
      }}
    >
      <DialogHeader>
        <DialogTitle>{t(old ? 'disclosures.editor.editTitle' : 'disclosures.editor.newTitle')}</DialogTitle>
        <DialogDescription>
          {old ? t('disclosures.editor.editDescription', { version: old.version + 1 }) : t('disclosures.editor.newDescription')}
        </DialogDescription>
      </DialogHeader>

      {!old && (
        <div className="grid gap-1.5">
          <Label htmlFor="disclosure-id">{t('disclosures.editor.id')}</Label>
          <Input
            id="disclosure-id"
            value={id}
            onChange={(e) => setId(e.target.value)}
            maxLength={64}
            className="w-56 font-mono"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!show('id') || undefined}
            aria-describedby="disclosure-id-hint"
            autoFocus
          />
          {show('id') ? <FieldError id="disclosure-id-hint">{show('id')}</FieldError> : <FieldHint id="disclosure-id-hint">{t('disclosures.editor.idHint')}</FieldHint>}
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="disclosure-title">{t('disclosures.editor.title')}</Label>
        <Input
          id="disclosure-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={MAX_SHORT}
          aria-invalid={!!show('title') || undefined}
          aria-describedby={show('title') ? 'disclosure-title-hint' : undefined}
          autoFocus={!!old}
        />
        {show('title') && <FieldError id="disclosure-title-hint">{show('title')}</FieldError>}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="disclosure-text">{t('disclosures.editor.text')}</Label>
        <Textarea
          id="disclosure-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          maxLength={MAX_LONG}
          aria-invalid={!!show('text') || undefined}
          aria-describedby={show('text') ? 'disclosure-text-hint' : undefined}
        />
        {show('text') && <FieldError id="disclosure-text-hint">{show('text')}</FieldError>}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="disclosure-placement">{t('disclosures.editor.placement')}</Label>
        <Textarea
          id="disclosure-placement"
          value={placement}
          onChange={(e) => setPlacement(e.target.value)}
          rows={2}
          maxLength={MAX_LONG}
          placeholder={t('disclosures.editor.placementPlaceholder')}
          aria-invalid={!!show('placement') || undefined}
          aria-describedby={show('placement') ? 'disclosure-placement-hint' : undefined}
        />
        {show('placement') && <FieldError id="disclosure-placement-hint">{show('placement')}</FieldError>}
      </div>

      <ProductChips value={products} onChange={setProducts} />
      <StatesField value={states} onChange={setStates} error={show('states')} />

      <div className="grid gap-1.5">
        <Label htmlFor="disclosure-effective">{t('rules.editor.effectiveDate')}</Label>
        <Input
          id="disclosure-effective"
          type="date"
          value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
          className="w-44"
          aria-invalid={!!show('effectiveDate') || undefined}
          aria-describedby={show('effectiveDate') ? 'disclosure-effective-hint' : undefined}
        />
        {show('effectiveDate') && <FieldError id="disclosure-effective-hint">{show('effectiveDate')}</FieldError>}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="disclosure-note">{t('rules.editor.note')}</Label>
        <Textarea
          id="disclosure-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={MAX_NOTE}
          aria-invalid={!!show('note') || undefined}
          aria-describedby="disclosure-note-hint"
        />
        {show('note') ? <FieldError id="disclosure-note-hint">{show('note')}</FieldError> : <FieldHint id="disclosure-note-hint">{t('rules.editor.noteHint')}</FieldHint>}
      </div>

      {old && <FlagPreview preview={preview} />}
      <SaveError error={save.error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t('rules.editor.cancel')}</Button>
        <Button type="submit" disabled={save.pending}>
          {old ? t('rules.editor.save', { version: old.version + 1 }) : t('disclosures.editor.create')}
        </Button>
      </DialogFooter>
    </form>
  )
}
