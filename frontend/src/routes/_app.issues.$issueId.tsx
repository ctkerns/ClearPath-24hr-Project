import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PlaceholderPage } from '@/components/placeholder-page'

export const Route = createFileRoute('/_app/issues/$issueId')({
  component: IssuePage,
})

function IssuePage() {
  const { t } = useTranslation()
  const { issueId } = Route.useParams()
  return (
    <PlaceholderPage
      title={t('page.issue', { id: issueId })}
      screen="6"
      route="/issues/$issueId"
      notes={[
        'Issue detail: owner, due date, status, linked material and live item.',
        'Actions by channel: pause ad, send affiliate notice, pause email flow, draft correction email, request page rollback.',
        'AI drafts the affiliate notice and correction email; a person edits and sends.',
      ]}
    />
  )
}
