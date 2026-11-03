import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

// Temporary page body for routes that are not designed yet.
// `notes` is planning text from the PRD, for the team only, so it is not translated.
export function PlaceholderPage({
  title,
  screen,
  route,
  notes,
  children,
}: {
  title?: string
  /** PRD section 10 screen number */
  screen: string
  route: string
  notes: string[]
  children?: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4">
      <header className="grid gap-1">
        {title && <h1 className="text-lg font-semibold">{title}</h1>}
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-sm bg-neutral-soft px-1.5 font-semibold text-neutral">{t('placeholder.label')}</span>
          <span>PRD screen {screen}</span>
          <code>{route}</code>
        </p>
      </header>
      <section className="grid gap-2 rounded-lg border border-dashed p-4">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('placeholder.planned')}</h2>
        <ul className="grid list-disc gap-1 pl-5 text-muted-foreground">
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </section>
      {children}
    </div>
  )
}
