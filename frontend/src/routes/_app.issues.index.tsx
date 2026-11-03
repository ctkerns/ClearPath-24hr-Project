import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PlaceholderPage } from '@/components/placeholder-page'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/_app/issues/')({
  component: IssuesPage,
})

function IssuesPage() {
  const { t } = useTranslation()
  return (
    <PlaceholderPage
      title={t('page.issues')}
      screen="6"
      route="/issues"
      notes={[
        'Issues list (F12): source, linked material and live item, severity, owner, due date, status.',
        'Affiliates see only their own issues (R4).',
      ]}
    >
      <div>
        <Button asChild variant="outline">
          <Link to="/issues/$issueId" params={{ issueId: 'ISS-0031' }}>ISS-0031 (sample)</Link>
        </Button>
      </div>
    </PlaceholderPage>
  )
}
