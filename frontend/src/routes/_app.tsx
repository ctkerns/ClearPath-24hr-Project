import { createFileRoute, Link, Outlet, type LinkProps } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AppLogo } from '@/components/app-logo'
import { UserMenu } from '@/components/user-menu'
import { WorkspaceBand } from '@/components/workspace-band'

// Layout route with no URL of its own ("_" prefix). Every signed-in page is a child of it.
// Affiliates will get the same shell with fewer links; the server limits what they can see (PRD R4).
export const Route = createFileRoute('/_app')({
  component: AppLayout,
})

// Active link: dark text and a cobalt underline on the bar's bottom edge (Ledger).
const navLinkClass =
  'flex h-full items-center px-2.5 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground ' +
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ' +
  '[&.active]:font-medium [&.active]:text-foreground [&.active]:shadow-[inset_0_-2px_0_var(--color-primary)]'

function AppLayout() {
  const { t } = useTranslation()
  const mainLinks: { to: LinkProps['to']; label: string }[] = [
    { to: '/home', label: t('nav.home') },
    { to: '/materials', label: t('nav.materials') },
    { to: '/issues', label: t('nav.issues') },
    { to: '/library', label: t('nav.library') },
    { to: '/metrics', label: t('nav.metrics') },
  ]

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-background">
        <WorkspaceBand />
        <div className="flex h-12 items-center gap-6 px-4 sm:px-6">
          <Link to="/home" aria-label={t('nav.home')} className="rounded-md focus-visible:outline-2 focus-visible:outline-ring">
            <AppLogo />
          </Link>
          <nav aria-label={t('nav.main')} className="flex h-full min-w-0 flex-1 overflow-x-auto">
            {mainLinks.map((link) => (
              <Link key={link.to} to={link.to} className={navLinkClass}>
                {link.label}
              </Link>
            ))}
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
