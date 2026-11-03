import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PlaceholderPage } from '@/components/placeholder-page'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const tabs = ['content', 'versions', 'history', 'live'] as const
type MaterialTab = (typeof tabs)[number]

// The tab is in the URL (?tab=versions) so a link opens the right tab.
export const Route = createFileRoute('/_app/materials/$materialId/')({
  validateSearch: (search: Record<string, unknown>): { tab?: MaterialTab } => {
    const tab = tabs.find((t) => t === search.tab)
    return tab && tab !== 'content' ? { tab } : {}
  },
  component: MaterialPage,
})

function MaterialPage() {
  const { t } = useTranslation()
  const { materialId } = Route.useParams()
  const { tab = 'content' } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <PlaceholderPage
      title={t('page.material', { id: materialId })}
      screen="4"
      route="/materials/$materialId?tab=…"
      notes={[
        'Review happens here, like a GitHub pull request page (F5).',
        'Main view: current version content with code, AI and human comments on the text, the checklist, and the status of each required group.',
        'Decision buttons show only to Reviewers in a required group while the material is In review.',
        'Owners read feedback, reply to comments, and use "Upload new version".',
      ]}
    >
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/materials/$materialId/new-version" params={{ materialId }}>{t('page.newVersion')}</Link>
        </Button>
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) =>
          navigate({ search: value === 'content' ? {} : { tab: value as MaterialTab }, replace: true })
        }
      >
        <TabsList>
          {tabs.map((id) => (
            <TabsTrigger key={id} value={id}>{t(`materialTabs.${id}`)}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="content" className="pt-2 text-muted-foreground">Content, comments, checklist, group status.</TabsContent>
        <TabsContent value="versions" className="pt-2 text-muted-foreground">Versions and side-by-side diff.</TabsContent>
        <TabsContent value="history" className="pt-2 text-muted-foreground">Audit log (append-only).</TabsContent>
        <TabsContent value="live" className="pt-2 text-muted-foreground">Live items, match status, and linked issues.</TabsContent>
      </Tabs>
    </PlaceholderPage>
  )
}
