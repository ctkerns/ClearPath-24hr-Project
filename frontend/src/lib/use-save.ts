import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/lib/api'

/**
 * For a dialog that saves to the server: runs the save, closes the dialog when it works,
 * and keeps the dialog open with the server's message when it fails.
 */
export function useSave(onDone: () => void) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  const run = async (save: () => Promise<unknown>) => {
    setPending(true)
    setError(undefined)
    try {
      await save()
      onDone()
    } catch (err) {
      setError(err instanceof ApiError && err.status < 500 ? err.detail : t('app.saveFailed'))
    } finally {
      setPending(false)
    }
  }

  return { pending, error, run }
}

/**
 * For a control that saves the moment it changes (a switch, a select, a menu action), with no dialog.
 * The control shows the server's data, and the cache changes only after a save works, so a failed save
 * leaves the control at its old value. This hook adds the two things the person needs: the control is busy
 * while the save runs, and a short message says the change was not saved and why.
 */
export function useInlineSave() {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  const run = async (save: () => Promise<unknown>) => {
    setPending(true)
    setError(undefined)
    try {
      await save()
    } catch (err) {
      setError(err instanceof ApiError && err.status < 500 ? err.detail : t('app.saveFailed'))
    } finally {
      setPending(false)
    }
  }

  return { pending, error, run: (save: () => Promise<unknown>) => void run(save), clear: () => setError(undefined) }
}
