import { useQuery } from '@tanstack/react-query'
import { useNavigate, type LinkProps } from '@tanstack/react-router'
import {
  BookText,
  ChartColumn,
  Flag,
  FileText,
  Files,
  LayoutDashboard,
  LibraryBig,
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
import { useViewer } from '@/lib/session'
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
// TODO: replace SEARCH_URL with a server search endpoint that takes the query and the user's role,
// so results respect permissions (affiliates see only their own items, PRD R4).
// Until then it loads a small seeded index and filters it in the browser.
const SEARCH_URL = '/demo/search.json'

type SearchIndex = {
  materials: { id: string; title: string; channel: string; status: MaterialStatus; approvalId?: string }[]
  issues: { id: string; title: string; material: string }[]
  rules: { id: string; title: string }[]
  disclosures: { id: string; title: string }[]
  buildingBlocks: { id: string; title: string }[]
}

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

  const index = useQuery({
    queryKey: ['search-index'],
    queryFn: async (): Promise<SearchIndex> => {
      const res = await fetch(SEARCH_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    enabled: open,
    staleTime: 5 * 60_000,
  })

  const go = (to: LinkProps['to'], params?: Record<string, string>) => {
    setOpen(false)
    setQuery('')
    // Each call site passes params that match its route.
    void navigate({ to, params } as Parameters<typeof navigate>[0])
  }

  const pages: { to: LinkProps['to']; label: string; icon: LucideIcon }[] = [
    { to: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard },
    { to: '/materials', label: t('nav.materials'), icon: Files },
    { to: '/issues', label: t('nav.issues'), icon: Flag },
    { to: '/library', label: t('nav.library'), icon: LibraryBig },
    { to: '/metrics', label: t('nav.metrics'), icon: ChartColumn },
    ...(settingsTabsFor(viewer.role).length ? [{ to: '/settings' as const, label: t('nav.settings'), icon: Settings }] : []),
    { to: '/design-system', label: t('nav.designSystem'), icon: Palette },
  ]

  const shortcut = isMac ? '⌘K' : 'Ctrl K'
  const typing = query.trim().length > 0
  const data = index.data

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
        className="top-[12%] translate-y-0 sm:max-w-xl"
      >
        <CommandInput value={query} onValueChange={setQuery} placeholder={t('search.placeholder')} />
        <CommandList className="max-h-[min(60vh,26rem)]">
          <CommandEmpty>{index.isError ? t('search.loadError') : t('search.empty')}</CommandEmpty>

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
              <CommandGroup heading={t('search.groups.materials')}>
                {data.materials.map((m) => (
                  <CommandItem
                    key={m.id}
                    value={`${m.title} ${m.channel} ${m.approvalId ?? ''} ${m.id}`}
                    onSelect={() => go('/materials/$materialId', { materialId: m.id })}
                  >
                    <FileText />
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate">{m.title}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {m.approvalId && <><code>{m.approvalId}</code> · </>}{m.channel}
                      </span>
                    </span>
                    <StatusPill status={m.status} />
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading={t('search.groups.issues')}>
                {data.issues.map((i) => (
                  <CommandItem
                    key={i.id}
                    value={`${i.id} ${i.title} ${i.material}`}
                    onSelect={() => go('/issues/$issueId', { issueId: i.id })}
                  >
                    <Flag />
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate">{i.title}</span>
                      <span className="truncate text-xs text-muted-foreground"><code>{i.id}</code> · {i.material}</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading={t('search.groups.library')}>
                {data.rules.map((r) => (
                  <LibraryItem key={r.id} icon={Scale} id={r.id} title={r.title} onSelect={() => go('/library/rules')} />
                ))}
                {data.disclosures.map((d) => (
                  <LibraryItem key={d.id} icon={BookText} id={d.id} title={d.title} onSelect={() => go('/library/disclosures')} />
                ))}
                {data.buildingBlocks.map((b) => (
                  <LibraryItem key={b.id} icon={Puzzle} id={b.id} title={b.title} onSelect={() => go('/library/building-blocks')} />
                ))}
              </CommandGroup>
            </>
          )}

          <CommandGroup heading={t('search.groups.pages')}>
            {pages.map((p) => (
              <CommandItem key={p.to} value={`page ${p.label}`} onSelect={() => go(p.to)}>
                <p.icon />
                {p.label}
              </CommandItem>
            ))}
          </CommandGroup>
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

function LibraryItem({ icon: Icon, id, title, onSelect }: { icon: LucideIcon; id: string; title: string; onSelect: () => void }) {
  return (
    <CommandItem value={`${id} ${title}`} onSelect={onSelect}>
      <Icon />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <code className="text-xs text-muted-foreground">{id}</code>
    </CommandItem>
  )
}
