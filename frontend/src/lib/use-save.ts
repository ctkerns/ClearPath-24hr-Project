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
