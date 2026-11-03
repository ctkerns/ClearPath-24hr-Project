import { FlaskConical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWorkspace } from '@/lib/workspace'

/**
 * Marks every page of the demo workspace, so nobody mistakes seeded data for real data (PRD A1).
 * Uses ink, not a meaning color: amber, red and green already mean risk levels.
 * The real workspace shows no band.
 */
export function WorkspaceBand() {
  const { t } = useTranslation()
  const workspace = useWorkspace()
  if (!workspace.isDemo) return null

  return (
    <div role="note" className="bg-foreground text-background">
      <div className="flex h-7 items-center gap-2 px-4 text-xs sm:px-6">
        <FlaskConical className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="font-semibold whitespace-nowrap">{t('workspace.demoLabel')}</span>
        <span className="truncate opacity-75">{t('workspace.demoNote')}</span>
      </div>
    </div>
  )
}
