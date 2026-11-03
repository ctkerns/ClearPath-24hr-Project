import { createFileRoute, Link, Outlet, type LinkProps } from '@tanstack/react-router'
import { ChartColumn, CircleDot, Files, House, LibraryBig, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { activeIndicatorClass, useActiveIndicator } from '@/lib/use-active-indicator'
import { AppLogo } from '@/components/app-logo'
import { UserMenu } from '@/components/user-menu'
import { WorkspaceBand } from '@/components/workspace-band'

// Layout route with no URL of its own ("_" prefix). Every signed-in page is a child of it.
// Affiliates will get the same shell with fewer links; the server limits what they can see (PRD R4).
export const Route = createFileRoute('/_app')({
  component: AppLayout,
})

// Active link: dark text, and a cobalt underline on the bar's bottom edge that slides between links (Ledger).
const navLinkClass =
  'flex h-full items-center gap-1.5 px-2.5 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground ' +
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ' +
  '[&.active]:font-medium [&.active]:text-foreground'

function AppLayout() {
  const { t } = useTranslation()
  const { containerRef, indicatorRef } = useActiveIndicator<HTMLElement>()
  const mainLinks: { to: LinkProps['to']; label: string; icon: LucideIcon }[] = [
    { to: '/home', label: t('nav.home'), icon: House },
    { to: '/materials', label: t('nav.materials'), icon: Files },
    { to: '/issues', label: t('nav.issues'), icon: CircleDot },
    { to: '/library', label: t('nav.library'), icon: LibraryBig },
    { to: '/metrics', label: t('nav.metrics'), icon: ChartColumn },
  ]

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-background">
        <WorkspaceBand />
        <div className="flex h-12 items-center gap-6 px-4 sm:px-6">
          <Link to="/home" aria-label={t('nav.home')} className="rounded-md focus-visible:outline-2 focus-visible:outline-ring">
            <AppLogo />
          </Link>
          <nav ref={containerRef} aria-label={t('nav.main')} className="relative flex h-full min-w-0 flex-1 overflow-x-auto">
            {mainLinks.map((link) => (
              <Link key={link.to} to={link.to} className={navLinkClass}>
                <link.icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
                {link.label}
              </Link>
            ))}
            <span ref={indicatorRef} aria-hidden="true" className={activeIndicatorClass} />
          </nav>
          <UserMenu />
        </div>
      </header>
      <main className="flex-1 px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  )
}
