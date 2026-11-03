import { useTranslation } from 'react-i18next'
import { diffWords } from './word-diff'

/**
 * One text with its changes marked inline, like track changes in Word or Google Docs:
 * removed words are struck through, added words are underlined in cobalt.
 * Changes are neither good nor bad, so they do not use the meaning colors.
 */
export function TrackedText({ before, after }: { before: string; after: string }) {
  const { t } = useTranslation()
  return diffWords(before, after).map((p, i) => {
    if (p.kind === 'same') return <span key={i}>{p.text}</span>
    if (p.kind === 'removed') {
      return (
        <del key={i} className="text-muted-foreground decoration-muted-foreground/70">
          <span className="sr-only">{t('review.changes.removed')} </span>{p.text}
        </del>
      )
    }
    return (
      <ins key={i} className="rounded-[2px] bg-primary-soft text-primary-strong decoration-primary underline-offset-2">
        <span className="sr-only">{t('review.changes.added')} </span>{p.text}
      </ins>
    )
  })
}

/** A list of fields with tracked changes, for example the live content against the approved version. */
export function TrackedFields({ before, after }: { before: { label: string; text: string }[]; after: { label: string; text: string }[] }) {
  const { t } = useTranslation()
  const labels = [...new Set([...before.map((f) => f.label), ...after.map((f) => f.label)])]
  return (
    <dl className="grid gap-4">
      {labels.map((label) => {
        const a = before.find((f) => f.label === label)?.text ?? ''
        const b = after.find((f) => f.label === label)?.text ?? ''
        return (
          <div key={label} className="grid gap-1">
            <dt className="text-xs font-medium text-muted-foreground">
              {label}
              {a === b && <span className="font-normal"> · {t('review.changes.unchanged')}</span>}
            </dt>
            <dd className="text-base leading-relaxed"><TrackedText before={a} after={b} /></dd>
          </div>
        )
      })}
    </dl>
  )
}
