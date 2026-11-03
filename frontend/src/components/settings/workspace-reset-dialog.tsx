import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const RESET_ITEMS = ['materials', 'issues', 'notifications', 'library', 'people', 'settings'] as const

/** Confirm the demo reset. It lists exactly what goes back to the seeded data and what stays. */
export function ResetDemoDialog({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: () => void }) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('settingsWorkspace.reset.title')}</DialogTitle>
          <DialogDescription>{t('settingsWorkspace.reset.description')}</DialogDescription>
        </DialogHeader>
        <ul className="grid list-disc gap-1 pl-5 text-sm">
          {RESET_ITEMS.map((item) => <li key={item}>{t(`settingsWorkspace.reset.items.${item}`)}</li>)}
        </ul>
        <p className="text-sm text-muted-foreground">{t('settingsWorkspace.reset.stays')}</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('settingsWorkspace.cancel')}</Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {t('settingsWorkspace.reset.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
