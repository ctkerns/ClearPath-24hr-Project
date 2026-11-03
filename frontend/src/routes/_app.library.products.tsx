import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ProductFormDialog } from '@/components/library/product-dialogs'
import { useProducts } from '@/components/library/product-data'
import { ProductListHeader, ProductRow } from '@/components/library/product-meta'
import { canEditLibrary } from '@/components/library/rule-data'
import { ListFrame } from '@/components/list/list-frame'
import { Button } from '@/components/ui/button'
import { useViewer } from '@/lib/session'

export const Route = createFileRoute('/_app/library/products')({
  component: ProductsTab,
})

/**
 * The products this workspace markets (PRD F8, US-66). A short list, so it has no filters: active products
 * first, by name, then the inactive ones. Adding a product opens its page, where the setup list says what it still needs.
 */
function ProductsTab() {
  const viewer = useViewer()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const products = useProducts()
  const [creating, setCreating] = useState(false)
  // R3: only Managers and Admins change the library. The server checks too.
  const canEdit = canEditLibrary(viewer.role)
  const all = [...(products.data ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-muted-foreground">{t('products.intro')}</p>
        {canEdit && (
          <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setCreating(true)} disabled={!products.data}>
            <Plus className="size-3.5" />
            {t('products.add')}
          </Button>
        )}
      </div>
      <ProductFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(p) => void navigate({ to: '/library/products/$productId', params: { productId: p.id } })}
      />

      <ListFrame
        query={products}
        // No filters, so an empty list is always the first-run state.
        filtered={false}
        isEmpty={all.length === 0}
        what={t('products.what')}
        emptyText=""
        firstRun={{ text: t(canEdit ? 'products.firstRunEditor' : 'products.firstRun') }}
        onClear={() => {}}
      >
        <ProductListHeader />
        <ul>
          {all.map((p) => (
            <li key={p.id} className="border-b">
              <ProductRow product={p} />
            </li>
          ))}
        </ul>
      </ListFrame>
    </div>
  )
}
