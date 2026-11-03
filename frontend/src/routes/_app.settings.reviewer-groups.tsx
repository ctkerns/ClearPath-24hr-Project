import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Lock, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListFrame, ListHeader } from '@/components/list/list-frame'
import { listRowClass } from '@/components/list/list-filters'
import { useMaterials } from '@/components/materials/material-data'
import { canManageGroups, membersOf, queueOf, useReviewerGroups, type ReviewerGroup } from '@/components/settings/group-data'
import { GroupFormDialog } from '@/components/settings/group-form-dialog'
import { DefaultGroupPill, MemberStack } from '@/components/settings/group-meta'
import { useUsers, type WorkspaceUser } from '@/components/settings/user-data'
import { Button } from '@/components/ui/button'
import type { Material } from '@/components/materials/material-data'
import { cn } from '@/lib/utils'
import { useViewer } from '@/lib/session'

export const Route = createFileRoute('/_app/settings/reviewer-groups')({
  component: ReviewerGroupsTab,
})

/**
 * PRD screen 9, Reviewer groups (F6). One row per group: what it reviews, who is in it, its review target and its queue now.
 * Each row opens the group's page, where a Manager edits it and its members.
 */
function ReviewerGroupsTab() {
  const viewer = useViewer()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const groups = useReviewerGroups()
  const users = useUsers()
  const materials = useMaterials()
  const [creating, setCreating] = useState(false)
  const canEdit = canManageGroups(viewer.role)
  const all = groups.data ?? []

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-muted-foreground">{t('settingsGroups.intro')}</p>
        {canEdit ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            {t('settingsGroups.create')}
          </Button>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden="true" />
            {t('settingsGroups.readOnly')}
          </p>
        )}
      </div>

      <ListFrame
        status={groups.status}
        // No groups is not a filter result, so the list shows its own empty line instead of "Clear all".
        isEmpty={false}
        emptyText=""
        errorText={t('settingsGroups.loadError')}
        onClear={() => {}}
      >
        <ListHeader
          columns={[
            { label: t('settingsGroups.column.group'), className: col.group },
            { label: t('settingsGroups.column.reviews'), className: col.reviews },
            { label: t('settingsGroups.column.members'), className: col.members },
            { label: t('settingsGroups.column.target'), className: col.target },
            { label: t('settingsGroups.column.queue'), className: col.queue },
          ]}
        />
        <ul>
          {all.map((g) => (
            <li key={g.id} className="border-b">
              <GroupRow group={g} users={users.data ?? []} materials={materials.data ?? []} />
            </li>
          ))}
        </ul>
        {all.length === 0 && <p className="border-b p-6 text-center text-muted-foreground">{t('settingsGroups.empty')}</p>}
      </ListFrame>

      <GroupFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => void navigate({ to: '/settings/reviewer-groups/$groupId', params: { groupId: id } })}
      />
    </div>
  )
}

/** Column widths, shared by the header and every row so they line up. */
const col = {
  group: 'w-52 shrink-0 max-sm:min-w-0 max-sm:flex-1',
  reviews: 'min-w-0 flex-1 max-sm:hidden',
  members: 'w-32 shrink-0 max-md:hidden',
  target: 'w-32 shrink-0 max-lg:hidden',
  queue: 'w-20 shrink-0 text-right',
}

function GroupRow({ group: g, users, materials }: { group: ReviewerGroup; users: WorkspaceUser[]; materials: Material[] }) {
  const { t } = useTranslation()
  const members = membersOf(users, g.name)
  const queue = queueOf(materials, g.name).length

  return (
    <Link to="/settings/reviewer-groups/$groupId" params={{ groupId: g.id }} className={listRowClass}>
      <span className={cn(col.group, 'flex min-w-0 items-center gap-2')}>
        <span className="truncate font-medium">{g.name}</span>
        {g.isDefault && <DefaultGroupPill />}
      </span>
      <span className={cn(col.reviews, 'truncate text-xs text-muted-foreground')} title={g.description}>{g.description}</span>
      <MemberStack members={members} className={col.members} />
      <span className={cn(col.target, 'text-xs tabular-nums')}>{t('settingsGroups.targetDays', { count: g.targetBusinessDays })}</span>
      <span className={cn(col.queue, 'tabular-nums', queue === 0 && 'text-muted-foreground')}>
        {queue}
        <span className="sr-only"> {t('settingsGroups.inQueue', { count: queue })}</span>
      </span>
    </Link>
  )
}
