import { Link } from '@tanstack/react-router'
import { Menu } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppLogo } from '@/components/app-logo'
import { useMainNavLinks } from '@/components/main-nav-links'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'

/**
 * Below the lg breakpoint (1024px) the main links move into a menu that slides in from the left.
 * The menu button sits where the links would start, so the bar keeps one order on every width.
 */
export function MobileNav() {
  const { t } = useTranslation()
  const links = useMainNavLinks()
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="-ml-1.5 text-muted-foreground hover:text-foreground lg:hidden" aria-label={t('nav.openMenu')}>
          <Menu className="size-5" strokeWidth={1.75} />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-0 p-0 sm:max-w-72">
        <SheetHeader className="h-12 flex-row items-center border-b px-4 py-0">
          <SheetTitle asChild>
            <div><AppLogo /></div>
          </SheetTitle>
          <SheetDescription className="sr-only">{t('nav.main')}</SheetDescription>
        </SheetHeader>
        <nav aria-label={t('nav.main')} className="grid gap-0.5 p-2">
          {links.map((link) => (
            <SheetClose key={link.to} asChild>
              <Link
                to={link.to}
                className="flex h-9 items-center gap-2.5 rounded-md px-2.5 text-base text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&.active]:bg-primary-soft [&.active]:font-medium [&.active]:text-primary-strong"
              >
                <link.icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
                {link.label}
              </Link>
            </SheetClose>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  )
}
