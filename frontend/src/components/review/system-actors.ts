import { Bot, ClipboardCheck, Radar, Route as RouteIcon, type LucideIcon } from 'lucide-react'

/** System authors get an icon instead of initials, so people and automation never look alike. */
export const systemActors: Record<string, LucideIcon> = {
  'Rule check': ClipboardCheck,
  'AI reviewer': Bot,
  Routing: RouteIcon,
  Monitoring: Radar,
}
