import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronLeft, Lock, Pencil, TriangleAlert, UserPlus, X } from 'lucide-react'
import type * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMaterials } from '@/components/materials/material-data'
import { ChannelIcon, GroupApprovals, PersonAvatar } from '@/components/materials/material-meta'
import { canManageGroups, membersOf, queueOf, useGroupUpdate, useReviewerGroups } from '@/components/settings/group-data'
import { GroupFormDialog } from '@/components/settings/group-form-dialog'
import { DefaultGroupPill } from '@/components/settings/group-meta'
import { GroupMembersDialog } from '@/components/settings/group-members-dialog'
import { useUsers } from '@/components/settings/user-data'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPill } from '@/components/ui/status-pill'
import { formatDate } from '@/i18n/format'
import { useViewer } from '@/lib/session'

// Not nested under the groups list route (the trailing _), so the list needs no Outlet.
// It still sits inside the Settings layout, so the tabs stay visible and Reviewer groups stays active.
export const Route = createFileRoute('/_app/settings/reviewer-groups_/$groupId')({
  component: GroupPage,
})

/** One reviewer group: what it reviews, its members, and what waits on it now (PRD F6). */
function GroupPage() {
  const viewer = useViewer()
  const { t } = useTranslation()
  const { groupId } = Route.useParams()
  const groups = useReviewerGroups()
  const users = useUsers()
  const materials = useMaterials()
  const update = useGroupUpdate()
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const canEdit = canManageGroups(viewer.role)
  const group = groups.data?.find((g) => g.id === groupId)

  if (groups.isPending) return <GroupSkeleton />
  if (!group) {
    return (
      <div className="grid justify-items-start gap-3">
        <BackLink />
        <p className="font-medium">{t('settingsGroups.notFound')}</p>
      </div>
    )
  }

  const members = membersOf(users.data ?? [], group.name)
  const queue = queueOf(materials.data ?? [], group.name)

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <BackLink />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-xl font-semibold">{group.name}</h2>
          {group.isDefault && <DefaultGroupPill />}
          {canEdit && (
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" />
              {t('settingsGroups.edit')}
            </Button>
          )}
        </div>
        {!canEdit && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden="true" />
            {t('settingsGroups.readOnly')}
          </p>
        )}
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-10">
        <div className="grid min-w-0 content-start gap-8">
          <blockquote className="max-w-3xl border-l-2 border-primary pl-4 text-base leading-relaxed">{group.description}</blockquote>

          <section className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <SectionHeading>{t('settingsGroups.members.heading', { count: members.length })}</SectionHeading>
              {canEdit && (
                <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                  <UserPlus aria-hidden="true" />
                  {t('settingsGroups.members.add')}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t('settingsGroups.members.note')}</p>
            {members.length === 0 ? (
              <Alert>
                <TriangleAlert className="text-risk-medium" aria-hidden="true" />
                <AlertDescription>{t('settingsGroups.members.empty', { count: queue.length })}</AlertDescription>
              </Alert>
            ) : (
              <ul className="overflow-hidden rounded-lg border">
                {members.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0">
                    <PersonAvatar name={m.name} className="size-7 text-[10px]" />
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate font-medium">{m.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{m.title}</span>
                    </span>
                    {m.status === 'invited' && <span className="text-xs text-muted-foreground max-sm:hidden">{t('settingsGroups.invited')}</span>}
                    <span className="w-20 text-xs text-muted-foreground max-sm:hidden">{t(`roles.${m.role}`)}</span>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => update.removeMember(group.name, m.id)}
                        aria-label={t('settingsGroups.members.remove', { name: m.name })}
                        title={t('settingsGroups.members.remove', { name: m.name })}
                      >
                        <X aria-hidden="true" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="grid gap-3">
            <SectionHeading>{t('settingsGroups.queue.heading', { count: queue.length })}</SectionHeading>
            {queue.length === 0 ? (
              <p className="text-muted-foreground">{t('settingsGroups.queue.empty')}</p>
            ) : (
              <ul className="overflow-hidden rounded-lg border">
                {queue.map((m) => (
                  <li key={m.id} className="border-b last:border-b-0">
                    <Link to="/materials/$materialId" params={{ materialId: m.id }} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/60">
                      <ChannelIcon channel={m.channel} className="size-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{m.title}</span>
                      <GroupApprovals groups={m.groups} className="max-lg:hidden" />
                      {m.submittedAt && (
                        <time dateTime={m.submittedAt} className="w-20 text-right text-xs text-muted-foreground tabular-nums max-sm:hidden">
                          {formatDate(m.submittedAt, { month: 'short', day: 'numeric' })}
                        </time>
                      )}
                      <StatusPill status={m.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="grid content-start gap-6 lg:sticky lg:top-16">
          <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm">
            <Detail label={t('settingsGroups.field.target')}>{t('settingsGroups.targetDays', { count: group.targetBusinessDays })}</Detail>
            <Detail label={t('settingsGroups.field.default')}>
              <span className="grid gap-0.5">
                <span>{group.isDefault ? t('settingsGroups.yes') : t('settingsGroups.no')}</span>
                <Link to="/settings/routing" className="text-xs text-primary hover:underline">{t('settingsGroups.field.defaultLink')}</Link>
              </span>
            </Detail>
            <Detail label={t('settingsGroups.field.members')}>{members.length}</Detail>
            <Detail label={t('settingsGroups.field.queue')}>{queue.length}</Detail>
            <Detail label={t('settingsGroups.field.created')}>
              <span className="grid gap-0.5">
                <span className="flex items-center gap-1.5"><PersonAvatar name={group.createdBy} className="size-5 text-[9px]" />{group.createdBy}</span>
                <span className="text-xs text-muted-foreground">{formatDate(group.createdAt)}</span>
              </span>
            </Detail>
            <Detail label={t('settingsGroups.field.updated')}>
              <span className="grid gap-0.5">
                <span className="flex items-center gap-1.5"><PersonAvatar name={group.updatedBy} className="size-5 text-[9px]" />{group.updatedBy}</span>
                <span className="text-xs text-muted-foreground">{formatDate(group.updatedAt)}</span>
              </span>
            </Detail>
          </dl>
        </aside>
      </div>

      <GroupFormDialog group={group} open={editing} onClose={() => setEditing(false)} />
      <GroupMembersDialog groupName={group.name} open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</h3>
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link to="/settings/reviewer-groups" className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
      <ChevronLeft className="size-3.5" />
      {t('settingsTabs.reviewerGroups')}
    </Link>
  )
}

function GroupSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-6 w-64 max-w-full" />
      <Skeleton className="mt-4 h-40 w-full" />
    </div>
  )
}
