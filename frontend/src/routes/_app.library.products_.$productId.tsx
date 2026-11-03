import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronLeft, Lock, Pencil } from 'lucide-react'
import { useState } from 'react'
import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { LoadError } from '@/components/load-error'
import { DeactivateProductDialog, ProductFormDialog } from '@/components/library/product-dialogs'
import { useProductUpdate, useProducts, type Product } from '@/components/library/product-data'
import { InactivePill, ProductSetup } from '@/components/library/product-meta'
import { canEditLibrary } from '@/components/library/rule-data'
import { PersonAvatar } from '@/components/materials/material-meta'
import { InlineSaveError } from '@/components/save-error'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/i18n/format'
import { notFoundError } from '@/lib/load-error'
import { useViewer } from '@/lib/session'
import { useInlineSave } from '@/lib/use-save'

// Not nested under the Products list route (trailing _), but still inside the Library layout and its tabs.
export const Route = createFileRoute('/_app/library/products_/$productId')({
  component: ProductPage,
})

/**
 * One product (PRD F8): what it is, what uses it, and what it still needs before its materials get a full review.
 * Managers rename it, change its description, and deactivate or reactivate it here.
 */
function ProductPage() {
  const viewer = useViewer()
  const { t } = useTranslation()
  const { productId } = Route.useParams()
  const products = useProducts()
  const p = products.data?.find((x) => x.id === productId)
  // R3: only Managers and Admins change the library. The server checks too.
  const canEdit = canEditLibrary(viewer.role)

  if (products.isPending) return <PageSkeleton />
  const failed = products.error ?? (p ? null : notFoundError)
  if (failed || !p) {
    return (
      <div className="grid justify-items-start gap-3">
        <BackLink />
        <LoadError error={failed} what={t('products.whatOne')} onRetry={() => products.refetch()} />
      </div>
    )
  }

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <BackLink />
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{p.name}</h1>
            {!p.active && <InactivePill />}
          </div>
          {canEdit && <Actions product={p} />}
        </div>
        <p className="max-w-3xl text-muted-foreground">{p.description}</p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><PersonAvatar name={p.createdBy} className="size-4 text-[8px]" />{p.createdBy}</span>
          <span>{t('products.addedOn', { date: formatDate(p.createdAt) })}</span>
        </p>
        {!p.active && <p className="max-w-3xl text-sm">{t('products.inactiveNote')}</p>}
        {!canEdit && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden="true" />
            {t('products.readOnly')}
          </p>
        )}
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-10">
        <Usage product={p} />
        <ProductSetup product={p} />
      </div>
    </div>
  )
}

/** Edit, and Deactivate or Reactivate. Reactivating is safe and undoable, so it needs no dialog. */
function Actions({ product: p }: { product: Product }) {
  const { t } = useTranslation()
  const { setActive } = useProductUpdate()
  const reactivate = useInlineSave()
  const [dialog, setDialog] = useState<'edit' | 'deactivate' | null>(null)

  return (
    <div className="grid justify-items-end gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setDialog('edit')}>
          <Pencil aria-hidden="true" />
          {t('products.edit')}
        </Button>
        {p.active ? (
          <Button size="sm" variant="outline" onClick={() => setDialog('deactivate')}>{t('products.deactivate.action')}</Button>
        ) : (
          <Button size="sm" variant="outline" disabled={reactivate.pending} onClick={() => reactivate.run(() => setActive(p.id, true))}>
            {t('products.reactivate')}
          </Button>
        )}
      </div>
      <InlineSaveError error={reactivate.error} />
      <ProductFormDialog product={p} open={dialog === 'edit'} onClose={() => setDialog(null)} />
      <DeactivateProductDialog product={p} open={dialog === 'deactivate'} onClose={() => setDialog(null)} />
    </div>
  )
}

/** What refers to the product now, each with a link to the list filtered to it. */
function Usage({ product: p }: { product: Product }) {
  const { t } = useTranslation()
  const u = p.usage
  const link = 'text-xs font-medium text-primary hover:underline'
  return (
    <section className="grid content-start gap-2" aria-labelledby="product-usage">
      <h2 id="product-usage" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('products.usage.heading')}</h2>
      <dl className="overflow-hidden rounded-lg border">
        <UsageRow label={t('products.usage.materials')} count={u.materials} note={u.materialsInReview > 0 ? t('products.usage.inReview', { count: u.materialsInReview }) : undefined}>
          <Link to="/materials" search={{ product: p.id }} className={link}>{t('products.usage.view')}</Link>
        </UsageRow>
        <UsageRow label={t('products.usage.rules')} count={u.rules}>
          <Link to="/library/rules" search={{ product: p.id }} className={link}>{t('products.usage.view')}</Link>
        </UsageRow>
        <UsageRow label={t('products.usage.disclosures')} count={u.disclosures}>
          <Link to="/library/disclosures" search={{ product: p.id }} className={link}>{t('products.usage.view')}</Link>
        </UsageRow>
        <UsageRow label={t('products.usage.blocks')} count={u.blocks}>
          <Link to="/library/building-blocks" search={{ product: p.id }} className={link}>{t('products.usage.view')}</Link>
        </UsageRow>
        <UsageRow label={t('products.usage.rates')} count={u.rateSheetRows}>
          <Link to="/library/rate-sheet" className={link}>{t('products.usage.view')}</Link>
        </UsageRow>
        <UsageRow label={t('products.usage.routing')} count={u.routingRules}>
          <Link to="/settings/routing" className={link}>{t('products.usage.view')}</Link>
        </UsageRow>
      </dl>
      <p className="text-xs text-muted-foreground">{t('products.usage.allProducts')}</p>
    </section>
  )
}

function UsageRow({ label, count, note, children }: { label: string; count: number; note?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-b px-3 py-2 last:border-b-0">
      <dt className="min-w-0 flex-1 text-sm">
        {label}
        {note && <span className="block text-xs text-muted-foreground">{note}</span>}
      </dt>
      <dd className="w-12 text-right text-sm tabular-nums">{count}</dd>
      <dd className="w-12 text-right">{count > 0 && children}</dd>
    </div>
  )
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link to="/library/products" className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
      <ChevronLeft className="size-3.5" />
      {t('libraryTabs.products')}
    </Link>
  )
}

function PageSkeleton() {
  return (
    <div className="grid gap-3">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-6 w-64 max-w-full" />
      <Skeleton className="mt-4 h-40 w-full" />
    </div>
  )
}
