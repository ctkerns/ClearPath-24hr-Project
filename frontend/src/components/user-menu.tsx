import { Link } from '@tanstack/react-router'
import { LogOut, Palette, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PersonAvatar } from '@/components/materials/material-meta'
import { demoViewer } from '@/components/review/material-detail-data'
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
 * Shows who is signed in: initials on the button, then name, role, reviewer groups and workspace in the menu.
 * TODO: read the user from the session (F1) instead of demoViewer.
 * Later: show Settings only to roles that can change at least one settings tab.
 */
export function UserMenu() {
  const { t } = useTranslation()
  const workspace = useWorkspace()
  const viewer = demoViewer
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('nav.accountOf', { name: viewer.name })} className="rounded-full">
          <PersonAvatar name={viewer.name} className="size-7 text-[11px]" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex items-center gap-2.5 py-2">
          <PersonAvatar name={viewer.name} className="size-8 text-xs" />
          <span className="grid min-w-0 gap-0.5">
            <span className="truncate">{viewer.name}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">
              {t(`roles.${viewer.role}`)} · {viewer.groups.join(', ')}
            </span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="grid gap-0.5 py-1">
          <span className="text-xs font-normal text-muted-foreground">{t('workspace.label')}</span>
          <span className="truncate font-normal">{workspace.name}</span>
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
