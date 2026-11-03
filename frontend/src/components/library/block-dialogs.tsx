import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Product } from '@/components/materials/material-data'
import { SaveError } from '@/components/save-error'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSave } from '@/lib/use-save'
import { useBlockUpdate, type Block } from './block-data'
import { dateFromToday, focusFirstInvalid } from './form-utils'
import { FieldError, ProductChips, StatesField } from './library-fields'

/**
 * Change where a building block is approved and when the approval expires (PRD F9; Managers only, R3).
 * The text and type stay as they were approved, so a Manager cannot change approved words here.
 */
export function BlockScopeDialog({ block, open, onClose }: { block: Block; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {/* Mounted only while open, so each time starts from the saved block. */}
        {open && <ScopeForm block={block} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function ScopeForm({ block, onClose }: { block: Block; onClose: () => void }) {
  const { t } = useTranslation()
  const update = useBlockUpdate()
  const save = useSave(onClose)
  const [products, setProducts] = useState<Product[]>(block.products)
  const [states, setStates] = useState<'all' | string[]>(block.states)
  const [expiresAt, setExpiresAt] = useState(block.expiresAt)
  const [tried, setTried] = useState(false)

  // The server needs an expiry after today (F9, F15), so tomorrow is the earliest choice.
  const tomorrow = dateFromToday(1)
  const errors = {
    states: states === 'all' || states.length > 0 ? undefined : t('disclosures.editor.statesMissing'),
    expiresAt: !expiresAt ? t('rules.editor.required') : expiresAt < tomorrow ? t('blocks.editor.expiryPast') : undefined,
  }
  const ready = !errors.states && !errors.expiresAt
  const show = (key: keyof typeof errors) => (tried ? errors[key] : undefined)

  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        setTried(true)
        if (!ready) focusFirstInvalid(e.currentTarget)
        if (!ready || save.pending) return
        void save.run(() => update.edit(block.id, { products, states, expiresAt }))
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('blocks.editor.title')}</DialogTitle>
        <DialogDescription>{t('blocks.editor.description')}</DialogDescription>
      </DialogHeader>

      {/* The approved words, read only, so the Manager sees what the scope is for. */}
      <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm leading-snug">{block.text}</p>

      <ProductChips value={products} onChange={setProducts} />
      <StatesField value={states} onChange={setStates} error={show('states')} />

      <div className="grid gap-1.5">
        <Label htmlFor="block-expires">{t('blocks.editor.expiresAt')}</Label>
        <Input
          id="block-expires"
          type="date"
          min={tomorrow}
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="w-44"
          aria-invalid={!!show('expiresAt') || undefined}
          aria-describedby={show('expiresAt') ? 'block-expires-hint' : undefined}
        />
        {show('expiresAt') && <FieldError id="block-expires-hint">{show('expiresAt')}</FieldError>}
      </div>

      <SaveError error={save.error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t('blocks.editor.cancel')}</Button>
        <Button type="submit" disabled={save.pending}>{t('blocks.editor.save')}</Button>
      </DialogFooter>
    </form>
  )
}

/**
 * Confirm deleting a building block (PRD F9; Managers only, R3). Materials keep their text; only the library entry goes.
 * `onDeleted` runs after the server deletes it, for example to leave the block's page.
 */
export function BlockDeleteDialog({ block, open, onClose, onDeleted }: {
  block: Block
  open: boolean
  onClose: () => void
  onDeleted: () => Promise<unknown>
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {open && <DeleteConfirm block={block} onClose={onClose} onDeleted={onDeleted} />}
      </DialogContent>
    </Dialog>
  )
}

function DeleteConfirm({ block, onClose, onDeleted }: { block: Block; onClose: () => void; onDeleted: () => Promise<unknown> }) {
  const { t } = useTranslation()
  const update = useBlockUpdate()
  const save = useSave(onClose)
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('blocks.editor.deleteTitle')}</DialogTitle>
        <DialogDescription>{t('blocks.editor.deleteDescription')}</DialogDescription>
      </DialogHeader>
      <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm leading-snug">{block.text}</p>
      <SaveError error={save.error} />
      <DialogFooter>
        {/* Cancel has focus first, so Enter does not delete by accident. */}
        <Button type="button" variant="outline" onClick={onClose} autoFocus>{t('blocks.editor.cancel')}</Button>
        <Button
          type="button"
          variant="destructive"
          disabled={save.pending}
          onClick={() =>
            void save.run(async () => {
              await update.remove(block.id)
              // Leave the page first, then drop the block from the list, so its page never shows "not found".
              await onDeleted()
              update.forget(block.id)
            })
          }
        >
          {t('blocks.editor.deleteConfirm')}
        </Button>
      </DialogFooter>
    </>
  )
}
