import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { AlertTriangle, ChevronLeft, ArrowLeftRight, Lock, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { blockStates, expiryState, useBlocks, type Block } from '@/components/library/block-data'
import { BlockDeleteDialog, BlockScopeDialog } from '@/components/library/block-dialogs'
import { canEditLibrary } from '@/components/library/rule-data'
import { BlockExpiry, BlockKindLabel } from '@/components/library/block-meta'
import { CopyButton } from '@/components/library/copy-button'
import { useBlockList } from '@/components/library/use-block-list'
import { PRODUCTS } from '@/components/materials/material-data'
import { PersonAvatar } from '@/components/materials/material-meta'
import { useViewer } from '@/lib/session'
import { useLicensedStates } from '@/components/settings/workspace-data'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/i18n/format'
import { cn } from '@/lib/utils'

// Not nested under the list route (the trailing _ in the file name), so the list does not need an Outlet.
// It still sits inside the Library layout, so the tabs stay visible and Building blocks stays active.
export const Route = createFileRoute('/_app/library/building-blocks_/$blockId')({
  component: BlockPage,
})

/** One building block: the exact approved text first, then where it may be used and what it can replace. */
function BlockPage() {
  const viewer = useViewer()
  const { t } = useTranslation()
  const { blockId } = Route.useParams()
  const blocks = useBlocks()
  const { label } = useBlockList()
  const licensedStates = useLicensedStates()
  const block = blocks.data?.find((b) => b.id === blockId)
  // R3: only Managers and Admins change the library. The server checks too.
  const canEdit = canEditLibrary(viewer.role)
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<'scope' | 'delete'>()

  if (blocks.isPending) return <BlockSkeleton />
  if (!block) {
    return (
      <div className="grid justify-items-start gap-3">
        <BackLink />
        <p className="font-medium">{t('blocks.notFound')}</p>
      </div>
    )
  }
  const expiry = expiryState(block.expiresAt)
  const swaps = swapCandidates(block, blocks.data ?? [], licensedStates)
  const kindLower = t(`blocks.kindLower.${block.kind}`)

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <BackLink />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <BlockKindLabel kind={block.kind} className="font-medium text-foreground" />
            <span>{t('blocks.approvedLine', { date: formatDate(block.approvedAt), name: block.approvedBy })}</span>
          </p>
          {canEdit && (
            // F9: Managers curate the products, states and expiry, or remove the block. The text stays as approved.
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setDialog('scope')}>
                <Pencil aria-hidden="true" />
                {t('blocks.editor.edit')}
              </Button>
              <Button size="sm" variant="destructive-outline" onClick={() => setDialog('delete')}>
                <Trash2 aria-hidden="true" />
                {t('blocks.editor.delete')}
              </Button>
              <BlockScopeDialog block={block} open={dialog === 'scope'} onClose={() => setDialog(undefined)} />
              <BlockDeleteDialog
                block={block}
                open={dialog === 'delete'}
                onClose={() => setDialog(undefined)}
                onDeleted={() => navigate({ to: '/library/building-blocks' })}
              />
            </div>
          )}
        </div>
        {!canEdit && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden="true" />
            {t('blocks.readOnly')}
          </p>
        )}
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-10">
        <div className="grid min-w-0 content-start gap-8">
          {expiry !== 'current' && (
            <p className={cn('flex max-w-3xl items-start gap-2 rounded-md px-3 py-2 shadow-[inset_0_0_0_1px_currentColor]', expiry === 'expired' ? 'bg-risk-high-soft text-risk-high' : 'bg-risk-medium-soft text-risk-medium')}>
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {t(expiry === 'expired' ? 'blocks.expiredWarning' : 'blocks.expiringWarning', { date: formatDate(block.expiresAt) })}
            </p>
          )}

          {/* The text is the page title and the thing people copy, so it sits in one bordered box, as written. */}
          <section className="grid max-w-3xl gap-2">
            <div className="grid gap-3 rounded-lg border bg-card p-4">
              <h1 className={cn('text-xl leading-snug whitespace-pre-wrap', block.kind === 'headline' ? 'font-semibold' : 'font-normal')}>{block.text}</h1>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                <span className="text-xs text-muted-foreground tabular-nums">{t('blocks.characters', { count: block.text.length })}</span>
                <CopyButton text={block.text} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t('blocks.exactNote')}</p>
          </section>

          <section className="grid max-w-3xl gap-3">
            <SectionHeading>{t('blocks.swap.heading')}</SectionHeading>
            <p className="flex items-start gap-2">
              <ArrowLeftRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {t('blocks.swap.note', { kind: kindLower })}
            </p>
            {swaps.length > 0 ? (
              <ul className="overflow-hidden rounded-lg border">
                {swaps.map((s) => (
                  <li key={s.id} className="border-b last:border-b-0">
                    <Link
                      to="/library/building-blocks/$blockId"
                      params={{ blockId: s.id }}
                      className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/60"
                    >
                      <span className="min-w-0 flex-1 leading-snug">{s.text}</span>
                      <BlockExpiry expiresAt={s.expiresAt} short className="shrink-0 text-xs text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">{t('blocks.swap.none', { kind: kindLower })}</p>
            )}
          </section>
        </div>

        <aside className="grid content-start gap-6 lg:sticky lg:top-16">
          <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm">
            <Detail label={t('blocks.field.kind')}><BlockKindLabel kind={block.kind} className="text-sm text-foreground" /></Detail>
            <Detail label={t('blocks.field.product')}>{block.products.length ? block.products.map((p) => label('product', p)).join(', ') : t('rules.allProducts')}</Detail>
            <Detail label={t('blocks.field.state')}>{block.states === 'all' ? t('rules.allStates') : block.states.join(', ')}</Detail>
            <Detail label={t('blocks.expires')}><BlockExpiry expiresAt={block.expiresAt} /></Detail>
            <Detail label={t('blocks.approved')}>{formatDate(block.approvedAt)}</Detail>
            <Detail label={t('blocks.approvedBy')}>
              <span className="flex items-center gap-1.5"><PersonAvatar name={block.approvedBy} className="size-5 text-[9px]" />{block.approvedBy}</span>
            </Detail>
            <Detail label={t('blocks.usedIn')}>{t('blocks.usedInCount', { count: block.usedIn })}</Detail>
          </dl>

          <section className="grid gap-2">
            <SectionHeading>{t('blocks.savedFrom.heading')}</SectionHeading>
            <Link
              to="/materials/$materialId"
              params={{ materialId: block.savedFrom.id }}
              className="rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-muted/60"
            >
              {block.savedFrom.title}
            </Link>
            <p className="text-xs text-muted-foreground">{t('blocks.savedFrom.note', { name: block.approvedBy })}</p>
          </section>
        </aside>
      </div>
    </div>
  )
}

/**
 * Other current blocks of the same kind that are approved for at least this block's products and states.
 * Swapping in one of them is a "building block swap", so the new version takes the lighter path (F6).
 */
function swapCandidates(block: Block, all: Block[], licensedStates: readonly string[]) {
  const products = (b: Block) => (b.products.length ? b.products : [...PRODUCTS])
  const covers = (outer: string[], inner: string[]) => inner.every((x) => outer.includes(x))
  return all.filter(
    (b) =>
      b.id !== block.id &&
      b.kind === block.kind &&
      expiryState(b.expiresAt) !== 'expired' &&
      covers(products(b), products(block)) &&
      covers(blockStates(b, licensedStates), blockStates(block, licensedStates)),
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</h2>
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link to="/library/building-blocks" className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
      <ChevronLeft className="size-3.5" />
      {t('libraryTabs.buildingBlocks')}
    </Link>
  )
}

function BlockSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-3 w-64 max-w-full" />
      <Skeleton className="mt-4 h-32 w-full max-w-3xl" />
    </div>
  )
}
