import { Link } from '@tanstack/react-router'
import {
  Bell,
  CircleArrowUp,
  CircleCheck,
  CircleDot,
  CircleX,
  FilePen,
  Inbox,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime, formatRelativeTime } from '@/i18n/format'
import {
  useMarkNotificationsRead,
  useNotifications,
  type AppNotification,
  type NotificationType,
} from '@/lib/notifications'
import { cn } from '@/lib/utils'

// Icons by type. Colors stay neutral: red, amber and green mean risk levels, not events.
const typeIcon: Record<NotificationType, LucideIcon> = {
  assignment: Inbox,
  comment: MessageSquare,
  escalation: CircleArrowUp,
  issue: CircleDot,
  decision_approved: CircleCheck,
  decision_changes_requested: FilePen,
  decision_rejected: CircleX,
}

/** Bell in the app bar with the unread count, and a list of recent notifications (PRD F13). */
export function NotificationsMenu() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const notifications = useNotifications()
  const markRead = useMarkNotificationsRead()
  const list = notifications.data ?? []
  const unread = list.filter((n) => !n.read).length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
          aria-label={unread ? t('notifications.openUnread', { count: unread }) : t('notifications.title')}
        >
          <Bell className="size-[18px]" strokeWidth={1.75} />
          {unread > 0 && (
            // Cobalt, not red: an unread count is not a risk.
            <span className="absolute top-1 right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground tabular-nums ring-2 ring-background">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-[22rem] max-w-[calc(100vw-1rem)] gap-0 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <h2 className="font-semibold">{t('notifications.title')}</h2>
          <Button
            variant="link"
            size="xs"
            className="px-0"
            disabled={unread === 0}
            onClick={() => markRead.mutate(undefined)}
          >
            {t('notifications.markAllRead')}
          </Button>
        </div>

        {notifications.isPending ? (
          <div className="grid gap-3 p-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : notifications.isError ? (
          <p className="p-3 text-muted-foreground">{t('notifications.loadError')}</p>
        ) : list.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground">{t('notifications.empty')}</p>
        ) : (
          <ul className="max-h-[26rem] divide-y overflow-y-auto">
            {list.map((n) => (
              <li key={n.id}>
                <NotificationRow
                  notification={n}
                  onOpen={() => {
                    if (!n.read) markRead.mutate([n.id])
                    setOpen(false)
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}

function NotificationRow({ notification: n, onOpen }: { notification: AppNotification; onOpen: () => void }) {
  const { t } = useTranslation()
  const Icon = typeIcon[n.type]
  const body = (
    <>
      <Icon className={cn('mt-0.5 size-4 shrink-0', n.read ? 'text-muted-foreground' : 'text-primary')} strokeWidth={1.75} aria-hidden="true" />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className={cn('text-sm', n.read && 'text-muted-foreground')}>
          <Trans
            i18nKey={`notifications.type.${n.type}`}
            values={{ actor: n.actor, material: n.material, group: n.group, summary: n.summary }}
            components={[<b key="b" className="font-semibold text-foreground" />]}
          />
        </span>
        <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)} className="text-xs text-muted-foreground">
          {formatRelativeTime(n.createdAt)}
        </time>
      </span>
      {!n.read && (
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary">
          <span className="sr-only">{t('notifications.unread')}</span>
        </span>
      )}
    </>
  )
  const rowClass =
    'flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none'

  if (n.issueId) {
    return (
      <Link to="/issues/$issueId" params={{ issueId: n.issueId }} className={rowClass} onClick={onOpen}>
        {body}
      </Link>
    )
  }
  if (n.materialId) {
    return (
      <Link to="/materials/$materialId" params={{ materialId: n.materialId }} className={rowClass} onClick={onOpen}>
        {body}
      </Link>
    )
  }
  return (
    <button type="button" className={rowClass} onClick={onOpen}>
      {body}
    </button>
  )
}
