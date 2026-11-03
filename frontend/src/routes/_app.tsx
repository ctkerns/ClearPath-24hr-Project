import { createFileRoute, Link, Outlet, type LinkProps } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AppLogo } from '@/components/app-logo'

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

const utilityLinkClass =
  'rounded-md px-2 py-1 text-xs whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-accent-foreground ' +
  'focus-visible:outline-2 focus-visible:outline-ring [&.active]:text-foreground'

function AppLayout() {
  const { t } = useTranslation()
  const mainLinks: { to: LinkProps['to']; label: string }[] = [
    { to: '/home', label: t('nav.home') },
    { to: '/materials', label: t('nav.materials') },
    { to: '/issues', label: t('nav.issues') },
    { to: '/library', label: t('nav.library') },
    { to: '/metrics', label: t('nav.metrics') },
    { to: '/settings', label: t('nav.settings') },
  ]

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-background">
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
          <div className="flex shrink-0 items-center gap-1">
            <Link to="/design-system" className={utilityLinkClass}>{t('nav.designSystem')}</Link>
            <Link to="/sign-in" className={utilityLinkClass}>{t('nav.signOut')}</Link>
          </div>
        </div>
      </header>
      <main className="flex-1 px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  )
}
