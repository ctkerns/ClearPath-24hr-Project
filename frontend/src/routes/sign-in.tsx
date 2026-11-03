import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PlaceholderPage } from '@/components/placeholder-page'
import { Button } from '@/components/ui/button'

// Outside the _app layout: the only page with no app shell.
export const Route = createFileRoute('/sign-in')({
  component: SignInPage,
})

function SignInPage() {
  const { t } = useTranslation()
  return (
    <div className="p-6">
      <PlaceholderPage
        title={t('page.signIn')}
        screen="1"
        route="/sign-in"
        notes={[
          'Email and password sign-in (F1).',
          '"Try the demo" panel: one demo account per role, with a "Sign in as <role>" button that uses the normal sign-in flow.',
          'Demo accounts can open only the demo workspace.',
        ]}
      >
        <div>
          <Button asChild><Link to="/home">{t('page.signIn')}</Link></Button>
        </div>
      </PlaceholderPage>
    </div>
  )
}
