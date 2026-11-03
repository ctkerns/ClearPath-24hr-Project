import type { LinkProps } from '@tanstack/react-router'
import { ChartColumn, Flag, Files, LayoutDashboard, LibraryBig, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useViewer } from '@/lib/session'

/** The main sections, in order. One list for the desktop bar, the mobile menu and the search palette. */
export function useMainNavLinks(): { to: LinkProps['to']; label: string; icon: LucideIcon }[] {
  const { t } = useTranslation()
  const internal = useViewer().role !== 'affiliate'
  return [
    { to: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard },
    { to: '/materials', label: t('nav.materials'), icon: Files },
    { to: '/issues', label: t('nav.issues'), icon: Flag },
    // The library and Metrics are for internal users only: their APIs give affiliates 403 (PRD section 4, R4).
    ...(internal
      ? [
          { to: '/library' as const, label: t('nav.library'), icon: LibraryBig },
          { to: '/metrics' as const, label: t('nav.metrics'), icon: ChartColumn },
        ]
      : []),
  ]
}
