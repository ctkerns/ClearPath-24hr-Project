import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router'
import { sessionQuery } from '@/lib/session'
import { setWorkspaceTimeZone } from '@/lib/workspace-time'
import { useTranslation } from 'react-i18next'
import { activeIndicatorClass, useActiveIndicator } from '@/lib/use-active-indicator'
import { AppLogo } from '@/components/app-logo'
import { GlobalSearch } from '@/components/global-search'
import { useMainNavLinks } from '@/components/main-nav-links'
import { MobileNav } from '@/components/mobile-nav'
import { NotificationsMenu } from '@/components/notifications-menu'
import { UserMenu } from '@/components/user-menu'
import { WorkspaceBand } from '@/components/workspace-band'

// Layout route with no URL of its own ("_" prefix). Every signed-in page is a child of it.
// Affiliates will get the same shell with fewer links; the server limits what they can see (PRD R4).
export const Route = createFileRoute('/_app')({
  // Asks the server who is signed in. No session: go to sign-in, and come back to this page after.
  // The user goes into the route context, so every page below reads it with useViewer().
  beforeLoad: async ({ location, context }) => {
    const viewer = await context.queryClient.ensureQueryData(sessionQuery)
    if (!viewer) throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    setWorkspaceTimeZone(viewer.timeZone) // before any page renders a day
    return { viewer }
  },
  component: AppLayout,
})

// Active link: dark text, and a cobalt underline on the bar's bottom edge that slides between links (Ledger).
const navLinkClass =
  'flex h-full items-center gap-1.5 px-2.5 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground ' +
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ' +
  '[&.active]:font-medium [&.active]:text-foreground'

// Widths: lg (1024px) and up shows the links in the bar. Below lg they move into MobileNav,
// and below lg the search box becomes an icon (see GlobalSearch).
function AppLayout() {
  const { t } = useTranslation()
  const { containerRef, indicatorRef } = useActiveIndicator<HTMLElement>()
  const mainLinks = useMainNavLinks()

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-background">
        <WorkspaceBand />
        <div className="flex h-12 items-center gap-2 px-3 sm:px-6 lg:gap-6">
          <MobileNav />
          <Link to="/dashboard" aria-label={t('nav.dashboard')} className="rounded-md focus-visible:outline-2 focus-visible:outline-ring">
            <AppLogo />
          </Link>
          <nav ref={containerRef} aria-label={t('nav.main')} className="relative hidden h-full min-w-0 flex-1 lg:flex">
            {mainLinks.map((link) => (
              <Link key={link.to} to={link.to} className={navLinkClass}>
                <link.icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
                {link.label}
              </Link>
            ))}
            <span ref={indicatorRef} aria-hidden="true" className={activeIndicatorClass} />
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <GlobalSearch />
            <NotificationsMenu />
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="flex-1 px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  )
}
