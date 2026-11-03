import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderPage } from '@/components/placeholder-page'

export const Route = createFileRoute('/_app/library/rules')({
  component: RulesTab,
})

function RulesTab() {
  return (
    <PlaceholderPage
      screen="7"
      route="/library/rules"
      notes={[
        'Rules library (F7): ID, title, text, jurisdiction, products, channels, citation, effective date, version, owner.',
        'Managers edit; Reviewers read.',
      ]}
    />
  )
}
