import { Link } from '@tanstack/react-router'
import { LogOut, Palette, Settings, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/lib/workspace'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * Right end of the app bar. Settings lives here, not in the main links.
 * Later: show the signed-in user's initials, name, role and reviewer groups (needs F1).
 * Later: show Settings only to roles that can change at least one settings tab.
 */
export function UserMenu() {
  const { t } = useTranslation()
  const workspace = useWorkspace()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('nav.account')} className="rounded-full">
          <span className="grid size-7 place-items-center rounded-full bg-primary-soft text-primary-strong">
            <UserRound className="size-4" />
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="grid gap-0.5">
          <span className="text-xs font-normal text-muted-foreground">{t('workspace.label')}</span>
          <span className="truncate">{workspace.name}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings"><Settings />{t('nav.settings')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/design-system"><Palette />{t('nav.designSystem')}</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/sign-in"><LogOut />{t('nav.signOut')}</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
