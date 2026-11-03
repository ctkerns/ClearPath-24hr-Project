import type { LinkProps } from '@tanstack/react-router'
import { ChartColumn, Flag, Files, LayoutDashboard, LibraryBig, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useViewer } from '@/lib/session'

/** The main sections, in order. One list for the desktop bar, the mobile menu and the search palette. */
export function useMainNavLinks(): { to: LinkProps['to']; label: string; icon: LucideIcon }[] {
  const { t } = useTranslation()
  const viewer = useViewer()
  return [
    { to: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard },
    { to: '/materials', label: t('nav.materials'), icon: Files },
    { to: '/issues', label: t('nav.issues'), icon: Flag },
    { to: '/library', label: t('nav.library'), icon: LibraryBig },
    // Metrics is for internal users only: GET /api/metrics gives affiliates 403 (PRD section 4).
    ...(viewer.role === 'affiliate' ? [] : [{ to: '/metrics' as const, label: t('nav.metrics'), icon: ChartColumn }]),
  ]
}
