import { createFileRoute, redirect } from '@tanstack/react-router'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppLogo } from '@/components/app-logo'
import { PersonAvatar } from '@/components/materials/material-meta'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DEMO_ACCOUNTS, DEMO_PASSWORD, safeRedirect, sessionQuery, signIn, type DemoAccount } from '@/lib/session'

// Outside the _app layout: the only page with no app shell. The landing page of the tool (PRD F1).
export const Route = createFileRoute('/sign-in')({
  validateSearch: (raw: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof raw.redirect === 'string' ? raw.redirect : undefined,
  }),
  // Already signed in: go straight on. If the server cannot answer, show the form anyway.
  beforeLoad: async ({ search, context }) => {
    const viewer = await context.queryClient.ensureQueryData(sessionQuery).catch(() => null)
    if (viewer) throw redirect({ to: safeRedirect(search.redirect) })
  },
  component: SignInPage,
})

/**
 * Sign-in (PRD screen 1): the email and password form, and the "Try the demo" panel beside it.
 * A demo button fills in the form and submits it, so demo accounts use the same sign-in as everyone (F1).
 */
function SignInPage() {
  const { t } = useTranslation()
  const { redirect: next } = Route.useSearch()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState<string>() // The email that is signing in, so the right button shows the spinner.

  const submit = async (e: string, p: string) => {
    setError(undefined)
    setPending(e)
    try {
      await signIn(e, p)
      // A full page load, so the app starts clean with this user's session.
      window.location.assign(safeRedirect(next))
    } catch (err) {
      const reason = err instanceof Error ? err.message : undefined
      setError(t(reason === 'invalid_credentials' ? 'signIn.error.invalid' : reason === 'rate_limited' ? 'signIn.error.tooMany' : 'signIn.error.unavailable'))
      setPending(undefined)
    }
  }

  const tryAccount = (account: DemoAccount) => {
    setEmail(account.email)
    setPassword(DEMO_PASSWORD)
    void submit(account.email, DEMO_PASSWORD)
  }

  return (
    <div className="flex min-h-svh flex-col bg-muted">
      <header className="flex h-14 items-center border-b bg-background px-4 sm:px-6">
        <AppLogo />
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:py-16">
        <div className="grid w-full max-w-4xl overflow-hidden rounded-lg border bg-card md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <section className="grid content-start gap-6 p-6 sm:p-8">
            <div className="grid gap-1">
              <h1 className="text-xl font-semibold">{t('signIn.heading')}</h1>
              <p className="text-sm text-muted-foreground">{t('signIn.who')}</p>
            </div>

            <form
              className="grid gap-4"
              noValidate
              onSubmit={(e) => {
                e.preventDefault()
                if (!email.trim() || !password) return setError(t('signIn.error.missing'))
                void submit(email, password)
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="email">{t('signIn.email')}</Label>
                <Input id="email" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={error ? true : undefined} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="password">{t('signIn.password')}</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-invalid={error ? true : undefined}
                    className="pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={t(showPassword ? 'signIn.hidePassword' : 'signIn.showPassword')}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              {error && <p role="alert" className="rounded-md bg-risk-high-soft px-3 py-2 text-sm text-risk-high">{error}</p>}

              <Button type="submit" disabled={pending !== undefined} className="w-full">
                {pending === email && pending !== undefined && <Loader2 className="animate-spin" />}
                {t('signIn.submit')}
              </Button>
            </form>

            <p className="text-xs text-muted-foreground">{t('signIn.forgot')}</p>
          </section>

          <section aria-labelledby="demo-heading" className="grid content-start gap-4 border-t bg-muted/50 p-6 sm:p-8 md:border-t-0 md:border-l">
            <div className="grid gap-1">
              <h2 id="demo-heading" className="text-sm font-semibold">{t('signIn.demo.heading')}</h2>
              <p className="text-xs text-muted-foreground">{t('signIn.demo.note')}</p>
              <p className="text-xs">
                {t('signIn.demo.password')} <code className="rounded-sm border bg-background px-1.5 py-0.5 text-xs">{DEMO_PASSWORD}</code>
              </p>
            </div>

            <ul className="overflow-hidden rounded-lg border bg-card">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.email} className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0">
                  <PersonAvatar name={a.name} className="size-8 text-xs" />
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <p className="truncate text-sm">
                      <span className="font-medium">{t(`roles.${a.role}`)}</span>
                      <span className="text-muted-foreground"> · {a.name}, {a.affiliate ?? a.title}</span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{t(`signIn.demo.can.${a.role}`)}</p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">{a.email}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending !== undefined}
                    onClick={() => tryAccount(a)}
                    aria-label={t('signIn.demo.signInAs', { role: t(`roles.${a.role}`) })}
                    className="shrink-0"
                  >
                    {pending === a.email && <Loader2 className="animate-spin" />}
                    {t('signIn.demo.signIn')}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>

      <footer className="px-4 pb-6 text-center text-xs text-muted-foreground">{t('signIn.footer')}</footer>
    </div>
  )
}
