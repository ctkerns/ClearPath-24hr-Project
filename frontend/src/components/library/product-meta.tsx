import { Link } from '@tanstack/react-router'
import { Check, Circle, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { Product } from './product-data'
import { setupSteps, stepsLeft, type SetupStep } from './product-setup'
import { listRowClass } from '@/components/list/list-filters'
import { ListHeader } from '@/components/list/list-frame'

// Small parts of the Products tab (PRD F8), shared by the list, the product page and the design-system page.

const pill = 'inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-xs font-medium whitespace-nowrap shadow-[inset_0_0_0_1px_currentColor]'

/** Only an inactive product gets a pill: active is the normal state, so it needs no label. */
export function InactivePill({ className }: { className?: string }) {
  const { t } = useTranslation()
  return <span className={cn(pill, 'bg-neutral-soft text-neutral', className)}>{t('products.inactive')}</span>
}

/**
 * The setup checklist on the product page: what the product has, and what is still missing before its
 * materials get a full review. Each line links to the place where a Manager adds it.
 */
export function ProductSetup({ product }: { product: Product }) {
  const { t } = useTranslation()
  const steps = setupSteps(product)
  const left = steps.filter((s) => !s.done).length

  return (
    <section className="grid gap-2" aria-labelledby="product-setup">
      <h2 id="product-setup" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('products.setup.heading')}</h2>
      <p className="text-sm">{left === 0 ? t('products.setup.ready') : t('products.setup.left', { count: left })}</p>
      <ol className="overflow-hidden rounded-lg border">
        {steps.map((s) => <SetupRow key={s.key} step={s} product={product} />)}
      </ol>
    </section>
  )
}

function SetupRow({ step: s, product }: { step: SetupStep; product: Product }) {
  const { t } = useTranslation()
  const Icon = s.done ? Check : s.blocking ? TriangleAlert : Circle
  return (
    <li className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 border-b px-3 py-2.5 last:border-b-0">
      <Icon
        className={cn('mt-0.5 size-4', s.done ? 'text-risk-low' : s.blocking ? 'text-risk-medium' : 'text-muted-foreground/60')}
        aria-hidden="true"
      />
      <p className="text-sm font-medium">
        {t(`products.setup.${s.key}.title`)}
        <span className="sr-only"> · {s.done ? t('products.setup.done') : t('products.setup.todo')}</span>
      </p>
      <p className="col-start-2 text-xs text-muted-foreground">
        {s.done ? t(`products.setup.${s.key}.done`, { count: s.count }) : t(`products.setup.${s.key}.todo`)}{' '}
        <SetupLink step={s} product={product} />
      </p>
    </li>
  )
}

/** Where the Manager adds the missing piece, or sees the ones that exist. */
function SetupLink({ step, product }: { step: SetupStep; product: Product }) {
  const { t } = useTranslation()
  const cls = 'font-medium text-primary hover:underline'
  const text = t(step.done ? 'products.setup.view' : `products.setup.${step.key}.action`)
  switch (step.key) {
    case 'rules': return <Link to="/library/rules" search={{ product: product.id }} className={cls}>{text}</Link>
    case 'disclosures': return <Link to="/library/disclosures" search={{ product: product.id }} className={cls}>{text}</Link>
    case 'rateSheet': return <Link to="/library/rate-sheet" className={cls}>{text}</Link>
    case 'routing': return <Link to="/settings/routing" className={cls}>{text}</Link>
  }
}

/** Column widths, shared by the header and every row so they line up. */
const col = {
  name: 'min-w-0 flex-1',
  materials: 'w-24 shrink-0 text-right max-sm:hidden',
  library: 'w-40 shrink-0 max-lg:hidden',
  rates: 'w-32 shrink-0 max-md:hidden',
  status: 'w-24 shrink-0 flex justify-end',
}

export function ProductListHeader() {
  const { t } = useTranslation()
  return (
    <ListHeader
      columns={[
        { label: t('products.column.product'), className: col.name },
        { label: t('products.column.materials'), className: col.materials },
        { label: t('products.column.library'), className: col.library },
        { label: t('products.column.rates'), className: col.rates },
        { label: t('products.column.status'), className: col.status },
      ]}
    />
  )
}

/**
 * One product on one row: name and description, how many materials use it, its rules and disclosures, and
 * whether the rate sheet has its rates. A product with setup left says so, so a new one stands out.
 */
export function ProductRow({ product: p }: { product: Product }) {
  const { t } = useTranslation()
  const left = stepsLeft(p)
  return (
    <Link to="/library/products/$productId" params={{ productId: p.id }} className={cn(listRowClass, 'h-auto items-start py-2.5', !p.active && 'text-muted-foreground')}>
      <span className={cn(col.name, 'grid gap-0.5')}>
        <span className="truncate font-medium">{p.name}</span>
        <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{p.description}</span>
      </span>
      <span className={cn(col.materials, 'pt-0.5 text-sm tabular-nums')}>{p.usage.materials}</span>
      <span className={cn(col.library, 'pt-0.5 text-xs text-muted-foreground')}>
        {t('products.libraryCounts', { rules: p.usage.rules, disclosures: p.usage.disclosures })}
      </span>
      <span className={cn(col.rates, 'pt-0.5 text-xs')}>
        {p.usage.rateSheetRows > 0 ? (
          <span className="text-muted-foreground">{t('products.rates', { count: p.usage.rateSheetRows })}</span>
        ) : (
          <span className="flex items-center gap-1 font-medium text-risk-medium">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
            {t('products.noRates')}
          </span>
        )}
      </span>
      <span className={cn(col.status, 'pt-0.5')}>
        {!p.active ? <InactivePill /> : left > 0 ? <span className="text-xs text-muted-foreground">{t('products.setup.left', { count: left })}</span> : null}
      </span>
    </Link>
  )
}
