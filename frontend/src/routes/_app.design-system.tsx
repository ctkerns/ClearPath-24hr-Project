import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { ChevronDown, Filter, Info, Plus, Search, TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SeverityLabel } from '@/components/ui/risk-tag'
import { GroupApprovals, LiveStatusTag } from '@/components/materials/material-meta'
import { LIVE_STATUSES, type GroupState } from '@/components/materials/material-data'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPill, type MaterialStatus } from '@/components/ui/status-pill'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FindingCard } from '@/components/review/finding-card'
import { FlaggedText } from '@/components/review/flagged-text'

// Design review page: every Ledger token and component in one place.
// Check any style change here before it ships to real screens.
// A tool for the team, not a product screen, so it exists only in development builds (npm run dev):
// a production build sends /design-system to the dashboard, and no menu links to it there.
export const Route = createFileRoute('/_app/design-system')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw redirect({ to: '/dashboard' })
  },
  component: DesignSystemPage,
})

const sections = [
  ['colors', 'Colors'],
  ['type', 'Type'],
  ['buttons', 'Buttons'],
  ['fields', 'Form fields'],
  ['status', 'Status'],
  ['review', 'Review parts'],
  ['tabs', 'Tabs'],
  ['table', 'Table'],
  ['cards', 'Cards and alerts'],
  ['overlays', 'Menus and dialogs'],
  ['misc', 'Other'],
] as const

const statuses: MaterialStatus[] = [
  'draft', 'submitted', 'in_review', 'changes_requested', 'rejected', 'approved', 'live', 'expired', 'retired',
]

function DesignSystemPage() {
  return (
    <div className="mx-auto flex max-w-6xl gap-10">
      <nav aria-label="Design system sections" className="sticky top-[6.25rem] hidden w-40 shrink-0 self-start lg:block">
        <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Ledger</p>
        <ul className="grid gap-0.5">
          {sections.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="block rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid min-w-0 flex-1 gap-12 pb-24">
        <header className="grid gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight">Ledger design system</h1>
          <p className="max-w-[68ch] text-muted-foreground">
            Every token and component that ClearPath screens use. Tokens live in <code>src/index.css</code>; base
            components in <code>src/components/ui</code>; review parts in <code>src/components/review</code>. Change a
            token, then check this page.
          </p>
        </header>

        <Section id="colors" title="Colors" note="Brand and neutrals set the look. Meaning colors are only for findings, severity and status.">
          <SwatchGroup title="Brand" names={['--primary', '--primary-strong', '--primary-soft', '--ring']} />
          <SwatchGroup title="Neutrals" names={['--foreground', '--muted-foreground', '--input', '--border', '--muted', '--background']} />
          <SwatchGroup
            title="Meaning"
            names={['--risk-high', '--risk-high-soft', '--risk-medium', '--risk-medium-soft', '--risk-low', '--risk-low-soft', '--info', '--info-soft', '--neutral', '--neutral-soft']}
          />
          <SwatchGroup title="Charts" names={['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5']} />
        </Section>

        <Section id="type" title="Type" note="IBM Plex Sans for all interface text. IBM Plex Mono for IDs, rule codes and platform IDs.">
          <div className="grid gap-0 divide-y rounded-lg border">
            <TypeRow label="text-xl · 22px · semibold" className="text-xl font-semibold tracking-tight">Metrics dashboard</TypeRow>
            <TypeRow label="text-lg · 18px · semibold" className="text-lg font-semibold">Summer personal loan, Meta feed ad</TypeRow>
            <TypeRow label="text-base · 14px" className="text-base">Long reading text, such as rule text and affiliate notices.</TypeRow>
            <TypeRow label="text-sm · 13px · default" className="text-sm">Body text in tables, forms and comments.</TypeRow>
            <TypeRow label="text-sm · muted" className="text-sm text-muted-foreground">Submitted by Dana Ortiz, Oct 30</TypeRow>
            <TypeRow label="text-xs · 11.5px · label" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Section label</TypeRow>
            <TypeRow label="font-mono · IDs" className="font-mono text-sm">CP-2026-0142-v3 · REGZ-1026.24</TypeRow>
            <TypeRow label="tabular-nums" className="text-sm tabular-nums">1,204 · 87.5% · 3d 4h</TypeRow>
          </div>
        </Section>

        <Section id="buttons" title="Buttons" note="One primary button per area. Use destructive-outline for Reject; solid destructive only to confirm in a dialog.">
          <Row label="Variants">
            <Button>Approve</Button>
            <Button variant="outline">Request changes</Button>
            <Button variant="secondary">Save draft</Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="destructive-outline">Reject</Button>
            <Button variant="destructive">Delete user</Button>
            <Button variant="link">View history</Button>
          </Row>
          <Row label="Sizes">
            <Button size="xs">Extra small</Button>
            <Button size="sm">Small</Button>
            <Button>Default</Button>
            <Button size="lg">Large</Button>
          </Row>
          <Row label="With icon">
            <Button><Plus /> New material</Button>
            <Button variant="outline"><Filter /> Filters</Button>
            <Button variant="outline" size="icon" aria-label="Search"><Search /></Button>
            <Button size="icon-sm" variant="ghost" aria-label="More"><ChevronDown /></Button>
          </Row>
          <Row label="Disabled">
            <Button disabled>Approve</Button>
            <Button variant="outline" disabled>Request changes</Button>
          </Row>
        </Section>

        <Section id="fields" title="Form fields">
          <div className="grid max-w-xl gap-4 sm:grid-cols-2">
            <Field label="Material title" htmlFor="ds-title">
              <Input id="ds-title" defaultValue="Summer personal loan" />
            </Field>
            <Field label="Search" htmlFor="ds-search">
              <Input id="ds-search" placeholder="Search materials" />
            </Field>
            <Field label="Product" htmlFor="ds-product">
              <Select defaultValue="personal">
                <SelectTrigger id="ds-product" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal loan</SelectItem>
                  <SelectItem value="card">Credit card</SelectItem>
                  <SelectItem value="mortgage">Mortgage prequalification</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Destination URL" htmlFor="ds-url" error="Enter a full URL, starting with https://">
              <Input id="ds-url" defaultValue="clearpath.com/loans" aria-invalid />
            </Field>
            <Field label="Disabled" htmlFor="ds-disabled">
              <Input id="ds-disabled" defaultValue="CP-2026-0142-v3" disabled />
            </Field>
            <div className="grid content-end gap-3">
              <div className="flex items-center gap-2">
                <Checkbox id="ds-nationwide" defaultChecked />
                <Label htmlFor="ds-nationwide">Nationwide</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="ds-pause" defaultChecked />
                <Label htmlFor="ds-pause">Pause unapproved ads</Label>
              </div>
            </div>
            <Field label="Comment" htmlFor="ds-comment" className="sm:col-span-2">
              <Textarea id="ds-comment" placeholder="Explain what must change" />
            </Field>
          </div>
        </Section>

        <Section id="status" title="Status" note="Status pills show where a material is in review. Live status tags show what monitoring found. Problems get a tinted fill.">
          <Row label="Status">
            {statuses.map((s) => <StatusPill key={s} status={s} />)}
          </Row>
          <Row label="Live status">
            {LIVE_STATUSES.map((s) => <LiveStatusTag key={s} status={s} />)}
          </Row>
          <Row label="Required groups">
            <GroupApprovals groups={[{ name: "Compliance", state: "approved" }, { name: "Legal", state: "waiting" }, { name: "Mortgage", state: "changes" }, { name: "Senior compliance", state: "rejected" }]} />
          </Row>
          <Row label="Severity">
            <SeverityLabel level="low" />
            <SeverityLabel level="medium" />
            <SeverityLabel level="high" />
          </Row>
          <Row label="Badges">
            <Badge>Verified</Badge>
            <Badge variant="secondary">Unverified</Badge>
            <Badge variant="outline">Seeded</Badge>
            <Badge variant="destructive">Error</Badge>
          </Row>
        </Section>

        <Section id="review" title="Review parts" note="Flagged text links to its finding card by number.">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="grid content-start gap-2 rounded-lg border p-4 text-base">
              <p>
                <FlaggedText severity="high" number={1}>Guaranteed approval</FlaggedText> for your summer projects.
              </p>
              <p>
                Borrow up to $25,000 and pay as little as <FlaggedText severity="high" number={2} active>$199/month</FlaggedText>.{' '}
                <FlaggedText severity="medium" number={3}>No credit check needed</FlaggedText> to see your rate.
              </p>
              <p className="text-xs text-muted-foreground">Mark 2 shows the active state (its card is selected).</p>
            </div>
            <div className="grid content-start gap-2 rounded-lg bg-muted p-3">
              <FindingCard
                number={1} severity="high" ruleId="UDAAP-03" source="ai"
                flaggedText="Guaranteed approval"
                explanation="is a banned phrase. ClearPath cannot promise approval before underwriting."
                suggestion="“Get a decision in minutes”"
              />
              <FindingCard
                number={2} severity="high" ruleId="REGZ-1026.24" source="ai"
                flaggedText="$199/month"
                explanation="is a Reg Z trigger term. The ad must state the APR range and term."
                suggestion="Insert block D-7 v3 (APR 8.99%–35.99%)"
                actions={<><Button size="xs">Insert block</Button><Button size="xs" variant="ghost">Hide</Button></>}
              />
              <FindingCard
                number={3} severity="medium" ruleId="FCRA-02" source="human" author="Maya Ruiz"
                flaggedText="No credit check needed"
                explanation="conflicts with the soft credit pull in the rate check."
              />
              <FindingCard
                severity="low" ruleId="BRAND-07" source="ai" status="outdated"
                flaggedText="Clearpath"
                explanation="must be written as “ClearPath”. Version 3 changed this text."
              />
            </div>
          </div>
        </Section>

        <Section id="tabs" title="Tabs">
          <Tabs defaultValue="content">
            <TabsList>
              <TabsTrigger value="content">Content</TabsTrigger>
              <TabsTrigger value="diff">Changes v2 → v3</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
            <TabsContent value="content" className="pt-2 text-muted-foreground">Content of version 3.</TabsContent>
            <TabsContent value="diff" className="pt-2 text-muted-foreground">Side-by-side changes.</TabsContent>
            <TabsContent value="history" className="pt-2 text-muted-foreground">Audit log.</TabsContent>
          </Tabs>
          <Tabs defaultValue="all">
            <TabsList variant="default">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="mine">Mine</TabsTrigger>
              <TabsTrigger value="overdue">Overdue</TabsTrigger>
            </TabsList>
          </Tabs>
          <p className="text-xs text-muted-foreground">Line tabs (default) switch views of one item. Segmented tabs filter a list.</p>
        </Section>

        <Section id="table" title="Table">
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"><Checkbox aria-label="Select all" /></TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Required groups</TableHead>
                  <TableHead>Approval ID</TableHead>
                  <TableHead className="text-right">Waiting</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sampleRows.map((r) => (
                  <TableRow key={r.id} data-state={r.selected ? 'selected' : undefined}>
                    <TableCell><Checkbox aria-label={`Select ${r.title}`} defaultChecked={r.selected} /></TableCell>
                    <TableCell>
                      <div className="font-medium">{r.title}</div>
                      <div className="text-xs text-muted-foreground">{r.channel}</div>
                    </TableCell>
                    <TableCell><StatusPill status={r.status} /></TableCell>
                    <TableCell><GroupApprovals groups={r.groups} /></TableCell>
                    <TableCell><code className="text-xs">{r.approvalId ?? '—'}</code></TableCell>
                    <TableCell className="text-right">{r.waiting}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>

        <Section id="cards" title="Cards and alerts" note="Use a card only to set one object apart. Most screens use plain panels with lines.">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Meta Marketing API</CardTitle>
                <CardDescription>Last sync 4 min ago</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Badge>Verified</Badge>
                <StatusPill status="live">Connected</StatusPill>
              </CardContent>
              <CardFooter className="gap-2">
                <Button size="sm" variant="outline">Sync now</Button>
              </CardFooter>
            </Card>
            <div className="grid content-start gap-3">
              <Alert>
                <Info />
                <AlertTitle>Demo workspace</AlertTitle>
                <AlertDescription>Data here is seeded. Reset it at any time.</AlertDescription>
              </Alert>
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>Ad paused</AlertTitle>
                <AlertDescription>The live ad differs from approved version 3.</AlertDescription>
              </Alert>
            </div>
          </div>
        </Section>

        <Section id="overlays" title="Menus and dialogs">
          <Row label="Try them">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">Actions <ChevronDown /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Material</DropdownMenuLabel>
                <DropdownMenuItem>Upload new version</DropdownMenuItem>
                <DropdownMenuItem>Export audit log</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive">Retire material</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive-outline">Reject</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Reject version 3?</DialogTitle>
                  <DialogDescription>The owner can still submit a new version. Add a reason for the audit log.</DialogDescription>
                </DialogHeader>
                <Textarea id="ds-reject-reason" placeholder="Reason" />
                <DialogFooter>
                  <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                  <Button variant="destructive">Reject version</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost">Hover for tooltip</Button>
              </TooltipTrigger>
              <TooltipContent>Only Reviewers with the High limit can lower a tier.</TooltipContent>
            </Tooltip>
          </Row>
        </Section>

        <Section id="misc" title="Other">
          <Row label="Avatars">
            <Avatar><AvatarFallback>MR</AvatarFallback></Avatar>
            <Avatar><AvatarFallback>DO</AvatarFallback></Avatar>
          </Row>
          <Row label="Loading">
            <div className="grid w-64 gap-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </Row>
          <Row label="Separator">
            <div className="flex h-5 items-center gap-3 text-muted-foreground">
              <span>Queue</span><Separator orientation="vertical" /><span>Repository</span>
            </div>
          </Row>
        </Section>
      </div>
    </div>
  )
}

const sampleRows: {
  id: string; title: string; channel: string; status: MaterialStatus; groups: { name: string; state: GroupState }[]
  approvalId?: string; waiting: string; selected?: boolean
}[] = [
  { id: '1', title: 'Summer personal loan', channel: 'Meta ad', status: 'in_review', groups: [{ name: 'Compliance', state: 'approved' }, { name: 'Legal', state: 'waiting' }], waiting: '1d 4h', selected: true },
  { id: '2', title: 'Balance transfer email', channel: 'Mailchimp', status: 'changes_requested', groups: [{ name: 'Compliance', state: 'changes' }], waiting: '3d 1h' },
  { id: '3', title: 'Mortgage prequal landing page', channel: 'WordPress', status: 'live', groups: [{ name: 'Compliance', state: 'approved' }, { name: 'Mortgage', state: 'approved' }], approvalId: 'CP-2026-0118-v2', waiting: '—' },
  { id: '4', title: 'Cash back card, affiliate post', channel: 'Affiliate · Impact', status: 'approved', groups: [{ name: 'Compliance', state: 'approved' }], approvalId: 'CP-2026-0131-v1', waiting: '—' },
]

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section id={id} className="grid scroll-mt-24 gap-4">
      <div className="grid gap-1 border-b pb-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {note && <p className="max-w-[72ch] text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center">
      <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

function Field({
  label, htmlFor, error, className, children,
}: { label: string; htmlFor: string; error?: string; className?: string; children: ReactNode }) {
  return (
    <div className={`grid content-start gap-1.5 ${className ?? ''}`}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function TypeRow({ label, className, children }: { label: string; className: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-baseline">
      <code className="text-xs text-muted-foreground">{label}</code>
      <span className={className}>{children}</span>
    </div>
  )
}

function SwatchGroup({ title, names }: { title: string; names: string[] }) {
  return (
    <div className="grid gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
        {names.map((n) => <Swatch key={n} name={n} />)}
      </div>
    </div>
  )
}

function Swatch({ name }: { name: string }) {
  // Tokens load with the app CSS before first render, so read the value once.
  const [value] = useState(() => getComputedStyle(document.documentElement).getPropertyValue(name).trim())
  return (
    <div className="grid gap-1.5">
      <div className="h-10 rounded-md border" style={{ background: `var(${name})` }} />
      <div className="grid">
        <code className="text-xs">{name}</code>
        <span className="font-mono text-xs text-muted-foreground uppercase">{value}</span>
      </div>
    </div>
  )
}
