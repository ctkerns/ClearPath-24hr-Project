import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate, type LinkProps } from '@tanstack/react-router'
import {
  BookText,
  Flag,
  FileText,
  Palette,
  Plus,
  Puzzle,
  Scale,
  Search,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { useViewer } from '@/lib/session'
import { useDebounced } from '@/lib/use-debounced'
import { useMainNavLinks } from '@/components/main-nav-links'
import type { Channel } from '@/components/materials/material-data'
import type { BlockKind } from '@/components/library/block-data'
import { settingsTabsFor } from '@/components/settings/settings-tabs'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { StatusPill, type MaterialStatus } from '@/components/ui/status-pill'
import { cn } from '@/lib/utils'

// Global search and jump-to palette (Cmd+K on Mac, Ctrl+K on Windows and Linux).
// The server searches (GET /api/search), so results show only what the viewer may open (PRD R4):
// affiliates see only their own company's materials and issues, and no library.

type SearchResults = {
  materials: { id: string; title: string; channel: Channel; affiliate?: string; status: MaterialStatus; approvalId?: string }[]
  /** material is absent when the issue has no material (unapproved content found live). */
  issues: { id: string; title: string; material?: string }[]
  rules: { id: string; title: string }[]
  disclosures: { id: string; title: string }[]
  buildingBlocks: { id: string; title: string; kind: BlockKind }[]
}

/** The server ignores shorter queries. */
const MIN_QUERY = 2

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

export function GlobalSearch() {
  const viewer = useViewer()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  // Cmd+K (Mac) or Ctrl+K (Windows, Linux) opens and closes search from anywhere.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (isMac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const term = query.trim().replace(/\s+/g, ' ')
  const debounced = useDebounced(term, 200)
  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api<SearchResults>('GET', `/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.length >= MIN_QUERY,
    placeholderData: keepPreviousData, // keep the last results while the next ones load
    staleTime: 30_000,
  })

  const go = (to: LinkProps['to'], params?: Record<string, string>, search?: Record<string, string>) => {
    setOpen(false)
    setQuery('')
    // Each call site passes params that match its route.
    void navigate({ to, params, search } as Parameters<typeof navigate>[0])
  }

  const mainLinks = useMainNavLinks()
  const pages: { to: LinkProps['to']; label: string; icon: LucideIcon }[] = [
    ...mainLinks,
    ...(settingsTabsFor(viewer.role).length ? [{ to: '/settings' as const, label: t('nav.settings'), icon: Settings }] : []),
    // A team tool: development builds only (see routes/_app.design-system.tsx).
    ...(import.meta.env.DEV ? [{ to: '/design-system' as const, label: t('nav.designSystem'), icon: Palette }] : []),
  ]

  const shortcut = isMac ? '⌘K' : 'Ctrl K'
  const typing = term.length > 0
  // The palette does not filter by itself (shouldFilter={false}): the server filters the results, and pages are filtered here.
  const shownPages = typing ? pages.filter((p) => `page ${p.label}`.toLowerCase().includes(term.toLowerCase())) : pages
  const data = term.length >= MIN_QUERY ? results.data : undefined
  const library = data ? [...data.rules, ...data.disclosures, ...data.buildingBlocks] : []

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('search.open')}
        aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
        className={cn(
          'flex h-8 items-center gap-2 rounded-md border border-input bg-muted px-2.5 text-muted-foreground transition-colors',
          'hover:border-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
          'max-lg:size-8 max-lg:justify-center max-lg:border-transparent max-lg:bg-transparent max-lg:px-0 lg:w-56',
        )}
      >
        <Search className="size-4 shrink-0" strokeWidth={1.75} />
        <span className="flex-1 text-left max-lg:hidden">{t('search.placeholderShort')}</span>
        <kbd className="rounded-sm border bg-background px-1 font-mono text-[10.5px] leading-4 max-lg:hidden">{shortcut}</kbd>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) setQuery('')
        }}
        title={t('search.title')}
        description={t('search.description')}
        showCloseButton={false}
        shouldFilter={false}
        className="top-[12%] translate-y-0 sm:max-w-xl"
      >
        <CommandInput value={query} onValueChange={setQuery} placeholder={t('search.placeholder')} />
        <CommandList className="max-h-[min(60vh,26rem)]">
          <CommandEmpty>
            {results.isError ? t('search.loadError') : term.length >= MIN_QUERY && !results.data ? t('search.loading') : t('search.empty')}
          </CommandEmpty>

          {!typing && (
            <CommandGroup heading={t('search.groups.actions')}>
              <CommandItem value="new submission" onSelect={() => go('/materials/new')}>
                <Plus />
                {t('page.newMaterial')}
              </CommandItem>
            </CommandGroup>
          )}

          {typing && data && (
            <>
              {data.materials.length > 0 && <CommandGroup heading={t('search.groups.materials')}>
                {data.materials.map((m) => (
                  <CommandItem
                    key={m.id}
                    value={`material ${m.id}`}
                    onSelect={() => go('/materials/$materialId', { materialId: m.id })}
                  >
                    <FileText />
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate">{m.title}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {m.approvalId && <><code>{m.approvalId}</code> · </>}
                        {t(`materials.channel.${m.channel}`)}{m.affiliate && ` · ${m.affiliate}`}
                      </span>
                    </span>
                    <StatusPill status={m.status} />
                  </CommandItem>
                ))}
              </CommandGroup>}
              {data.issues.length > 0 && <CommandGroup heading={t('search.groups.issues')}>
                {data.issues.map((i) => (
                  <CommandItem
                    key={i.id}
                    value={`issue ${i.id}`}
                    onSelect={() => go('/issues/$issueId', { issueId: i.id })}
                  >
                    <Flag />
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate">{i.title}</span>
                      <span className="truncate text-xs text-muted-foreground"><code>{i.id}</code>{i.material && <> · {i.material}</>}</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>}
              {library.length > 0 && <CommandGroup heading={t('search.groups.library')}>
                {/* Each opens its library list, filtered to it. */}
                {data.rules.map((r) => (
                  <LibraryItem key={r.id} value={`rule ${r.id}`} icon={Scale} title={r.title} tag={r.id} onSelect={() => go('/library/rules', undefined, { q: r.id })} />
                ))}
                {data.disclosures.map((d) => (
                  <LibraryItem key={d.id} value={`disclosure ${d.id}`} icon={BookText} title={d.title} tag={d.id} onSelect={() => go('/library/disclosures', undefined, { q: d.title })} />
                ))}
                {data.buildingBlocks.map((b) => (
                  <LibraryItem key={b.id} value={`block ${b.id}`} icon={Puzzle} title={b.title} tag={t(`blocks.kind.${b.kind}`)} onSelect={() => go('/library/building-blocks', undefined, { q: b.title })} />
                ))}
              </CommandGroup>}
            </>
          )}

          {shownPages.length > 0 && <CommandGroup heading={t('search.groups.pages')}>
            {shownPages.map((p) => (
              <CommandItem key={p.to} value={`page ${p.label}`} onSelect={() => go(p.to)}>
                <p.icon />
                {p.label}
              </CommandItem>
            ))}
          </CommandGroup>}
        </CommandList>
        <div className="flex items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
          <span><kbd className="font-mono">↑↓</kbd> {t('search.hints.move')}</span>
          <span><kbd className="font-mono">↵</kbd> {t('search.hints.open')}</span>
          <span><kbd className="font-mono">Esc</kbd> {t('search.hints.close')}</span>
          <CommandShortcut className="tracking-normal">{shortcut}</CommandShortcut>
        </div>
      </CommandDialog>
    </>
  )
}

function LibraryItem({ value, icon: Icon, title, tag, onSelect }: { value: string; icon: LucideIcon; title: string; tag: string; onSelect: () => void }) {
  return (
    <CommandItem value={value} onSelect={onSelect}>
      <Icon />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <code className="text-xs text-muted-foreground">{tag}</code>
    </CommandItem>
  )
}
