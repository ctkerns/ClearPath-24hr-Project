import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SaveError } from '@/components/save-error'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useSave } from '@/lib/use-save'
import { productNameTaken, useProductUpdate, useProducts, type Product } from './product-data'

/**
 * Add a product, or change its name and description (PRD F8, Managers only). Only two fields: the server
 * makes the ID, and everything else (rules, rates, routing) is set up where it lives, from the product page.
 */
export function ProductFormDialog({ product, open, onClose, onCreated }: {
  /** The product to edit. Leave it out to add one. */
  product?: Product
  open: boolean
  onClose: () => void
  onCreated?: (p: Product) => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {/* Mounted only while open, so each time starts from the saved values. */}
        {open && <ProductForm product={product} onClose={onClose} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  )
}

function ProductForm({ product, onClose, onCreated }: { product?: Product; onClose: () => void; onCreated?: (p: Product) => void }) {
  const { t } = useTranslation()
  const products = useProducts()
  const update = useProductUpdate()
  const save = useSave(onClose)
  const [name, setName] = useState(product?.name ?? '')
  const [description, setDescription] = useState(product?.description ?? '')

  const taken = productNameTaken(products.data ?? [], name, product?.id)
  const ready = name.trim() && description.trim() && !taken
  const renamed = product && name.trim() && name.trim() !== product.name

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready) return
        const input = { name: name.trim(), description: description.trim() }
        void save.run(async () => {
          if (product) await update.edit(product.id, input)
          else onCreated?.(await update.create(input))
        })
      }}
    >
      <DialogHeader>
        <DialogTitle>{product ? t('products.form.editTitle', { name: product.name }) : t('products.form.createTitle')}</DialogTitle>
        <DialogDescription>{product ? t('products.form.editDescription') : t('products.form.createDescription')}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="product-name">{t('products.form.name')}</Label>
        <Input
          id="product-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('products.form.namePlaceholder')}
          aria-invalid={taken || undefined}
          aria-describedby="product-name-hint"
          autoFocus
        />
        <p id="product-name-hint" className={taken ? 'text-xs font-medium text-destructive' : 'text-xs text-muted-foreground'}>
          {taken ? t('products.form.nameTaken') : renamed ? t('products.form.renameNote') : t('products.form.nameHint')}
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="product-description">{t('products.form.description')}</Label>
        <Textarea
          id="product-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder={t('products.form.descriptionPlaceholder')}
          aria-describedby="product-description-hint"
        />
        <p id="product-description-hint" className="text-xs text-muted-foreground">{t('products.form.descriptionHint')}</p>
      </div>

      <SaveError error={save.error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t('products.cancel')}</Button>
        <Button type="submit" disabled={!ready || save.pending}>{product ? t('products.form.save') : t('products.form.create')}</Button>
      </DialogFooter>
    </form>
  )
}

/**
 * Confirm a deactivation (PRD F8). It says exactly what changes and what stays, with the counts from the server,
 * because the Manager cannot see every list that uses the product from here. Reactivating needs no dialog.
 */
export function DeactivateProductDialog({ product, open, onClose }: { product: Product; open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const { setActive } = useProductUpdate()
  const save = useSave(onClose)
  const u = product.usage
  const keeps = u.rules + u.disclosures + u.blocks + u.routingRules

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('products.deactivate.title', { name: product.name })}</DialogTitle>
          <DialogDescription>{t('products.deactivate.description')}</DialogDescription>
        </DialogHeader>
        <ul className="grid list-disc gap-1.5 pl-5 text-sm marker:text-muted-foreground">
          <li>{t('products.deactivate.noNew')}</li>
          {u.materialsInReview > 0 && <li>{t('products.deactivate.inReview', { count: u.materialsInReview })}</li>}
          {keeps > 0 && <li>{t('products.deactivate.keeps', { count: keeps })}</li>}
          {u.rateSheetRows > 0 && <li>{t('products.deactivate.rates', { count: u.rateSheetRows })}</li>}
          <li>{t('products.deactivate.undo')}</li>
        </ul>
        <SaveError error={save.error} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('products.cancel')}</Button>
          <Button type="button" variant="destructive" disabled={save.pending} onClick={() => void save.run(() => setActive(product.id, false))}>
            {t('products.deactivate.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
