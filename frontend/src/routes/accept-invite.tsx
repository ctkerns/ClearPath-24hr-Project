import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppLogo } from '@/components/app-logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { acceptInvite, getInvite, PASSWORD_MIN_LENGTH, type InviteInfo } from '@/lib/session'

// Outside the _app layout, like sign-in: the person has no session yet. The link in the invite email opens it (PRD F16).
export const Route = createFileRoute('/accept-invite')({
  validateSearch: (raw: Record<string, unknown>): { token?: string } => ({
    token: typeof raw.token === 'string' ? raw.token : undefined,
  }),
  component: AcceptInvitePage,
})

type LinkProblem = 'invalid' | 'expired' | 'unavailable'

function linkProblem(err: unknown): LinkProblem {
  const reason = err instanceof Error ? err.message : undefined
  return reason === 'invalid' || reason === 'expired' ? reason : 'unavailable'
}

/** Checks the link, then asks for a name and a password. Accepting signs the person in and opens the Dashboard. */
function AcceptInvitePage() {
  const { t } = useTranslation()
  const { token } = Route.useSearch()
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => getInvite(token ?? ''),
    enabled: !!token,
    retry: false,
    staleTime: Infinity,
  })
  const problem: LinkProblem | undefined = !token ? 'invalid' : invite.isError ? linkProblem(invite.error) : undefined

  return (
    <div className="flex min-h-svh flex-col bg-muted">
      <header className="flex h-14 items-center border-b bg-background px-4 sm:px-6">
        <AppLogo />
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:py-16">
        <section className="grid w-full max-w-md content-start gap-6 rounded-lg border bg-card p-6 sm:p-8">
          {problem ? (
            <>
              <p role="alert" className="rounded-md bg-risk-high-soft px-3 py-2 text-sm text-risk-high">
                {t(`acceptInvite.error.${problem}`)}
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link to="/sign-in">{t('acceptInvite.toSignIn')}</Link>
              </Button>
            </>
          ) : invite.data ? (
            <AcceptForm token={token ?? ''} invite={invite.data} />
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {t('acceptInvite.checking')}
            </p>
          )}
        </section>
      </main>

      <footer className="px-4 pb-6 text-center text-xs text-muted-foreground">{t('signIn.footer')}</footer>
    </div>
  )
}

function AcceptForm({ token, invite }: { token: string; invite: InviteInfo }) {
  const { t } = useTranslation()
  const [name, setName] = useState(invite.name)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)

  const submit = async () => {
    if (password.length < PASSWORD_MIN_LENGTH) return setError(t('acceptInvite.error.short', { count: PASSWORD_MIN_LENGTH }))
    setError(undefined)
    setPending(true)
    try {
      await acceptInvite(token, password, name.trim())
      // A full page load, like sign-in, so the app starts clean with the new session.
      window.location.assign('/dashboard')
    } catch (err) {
      const reason = err instanceof Error ? err.message : undefined
      setError(
        reason === 'short_password'
          ? t('acceptInvite.error.short', { count: PASSWORD_MIN_LENGTH })
          : t(`acceptInvite.error.${linkProblem(err)}`),
      )
      setPending(false)
    }
  }

  return (
    <>
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">{t('acceptInvite.heading', { workspace: invite.workspaceName })}</h1>
        <p className="text-sm text-muted-foreground">{t('acceptInvite.intro')}</p>
      </div>

      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="email">{t('acceptInvite.email')}</Label>
          {/* Read-only, and here for password managers: they save the new password with this username. */}
          <Input id="email" type="email" autoComplete="username" value={invite.email} readOnly className="bg-muted" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="name">{t('acceptInvite.name')}</Label>
          <Input id="name" autoComplete="name" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">{t('acceptInvite.password')}</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby="password-hint"
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
          <p id="password-hint" className="text-xs text-muted-foreground">
            {t('acceptInvite.passwordHint', { count: PASSWORD_MIN_LENGTH })}
          </p>
        </div>

        {error && <p role="alert" className="rounded-md bg-risk-high-soft px-3 py-2 text-sm text-risk-high">{error}</p>}

        <Button type="submit" disabled={pending} className="w-full">
          {pending && <Loader2 className="animate-spin" />}
          {t('acceptInvite.submit')}
        </Button>
      </form>
    </>
  )
}
