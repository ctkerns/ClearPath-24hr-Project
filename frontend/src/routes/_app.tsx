import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

// Layout route with no URL of its own ("_" prefix). Every signed-in page is a child of it.
// The real app shell replaces the plain bar below. Affiliates will get the same shell
// with fewer links; the server limits what they can see (PRD R4).
export const Route = createFileRoute('/_app')({
  component: AppLayout,
})

const linkClass = 'text-muted-foreground hover:text-foreground [&.active]:font-semibold [&.active]:text-foreground'

function AppLayout() {
  const { t } = useTranslation()
  return (
    <div className="min-h-screen">
      <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-6 py-3 text-sm">
        <span className="font-semibold">{t('app.name')}</span>
        <Link to="/home" className={linkClass}>{t('nav.home')}</Link>
        <Link to="/materials" className={linkClass}>{t('nav.materials')}</Link>
        <Link to="/issues" className={linkClass}>{t('nav.issues')}</Link>
        <Link to="/library" className={linkClass}>{t('nav.library')}</Link>
        <Link to="/metrics" className={linkClass}>{t('nav.metrics')}</Link>
        <Link to="/settings" className={linkClass}>{t('nav.settings')}</Link>
        <span className="ml-auto flex gap-4">
          <Link to="/design-system" className={linkClass}>{t('nav.designSystem')}</Link>
          <Link to="/sign-in" className={linkClass}>{t('nav.signOut')}</Link>
        </span>
      </nav>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  )
}
