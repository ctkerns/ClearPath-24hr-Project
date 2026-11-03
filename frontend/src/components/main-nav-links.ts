import type { LinkProps } from '@tanstack/react-router'
import { ChartColumn, Flag, Files, LayoutDashboard, LibraryBig, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** The main sections, in order. One list for the desktop bar and the mobile menu. */
export function useMainNavLinks(): { to: LinkProps['to']; label: string; icon: LucideIcon }[] {
  const { t } = useTranslation()
  return [
    { to: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard },
    { to: '/materials', label: t('nav.materials'), icon: Files },
    { to: '/issues', label: t('nav.issues'), icon: Flag },
    { to: '/library', label: t('nav.library'), icon: LibraryBig },
    { to: '/metrics', label: t('nav.metrics'), icon: ChartColumn },
  ]
}
