import { Link } from '@tanstack/react-router'
import { Ban } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { ReviewerGroup } from './group-data'
import { matchesEverything, NO_MATERIAL_CHANGE_TYPES, useRoutingUpdate, type RoutingSettings } from './routing-data'
import { SectionHeading } from './routing-fields'

/** The default group (PRD F6, required): an item that matches no rule goes here. */
export function DefaultGroupSection({ settings, groups, canEdit }: { settings: RoutingSettings; groups: ReviewerGroup[]; canEdit: boolean }) {
  const { t } = useTranslation()
  const update = useRoutingUpdate()
  const current = groups.find((g) => g.isDefault)
  // A rule with no conditions matches everything, so the default group only acts as a safety net.
  const catchAll = settings.rules.find((r) => r.enabled && matchesEverything(r.conditions))

  return (
    <section className="grid gap-3" aria-labelledby="routing-default">
      <SectionHeading id="routing-default">{t('settingsRouting.default.heading')}</SectionHeading>
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-[14rem_minmax(0,1fr)] sm:items-start">
        <Select value={current?.id ?? ''} onValueChange={update.setDefaultGroup} disabled={!canEdit}>
          <SelectTrigger className="w-full" aria-label={t('settingsRouting.default.heading')}><SelectValue placeholder={t('settingsRouting.choose')} /></SelectTrigger>
          <SelectContent>{groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
        </Select>
        <div className="grid gap-1 text-sm">
          <p>{t('settingsRouting.default.help')}</p>
          {catchAll && (
            <p className="text-xs text-muted-foreground">
              {t('settingsRouting.default.catchAll', { n: settings.rules.indexOf(catchAll) + 1, name: catchAll.name })}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

/** The lighter path (PRD F6): a version with no material change needs one approval from this group. */
export function LighterPathSection({ settings, groups, canEdit }: { settings: RoutingSettings; groups: ReviewerGroup[]; canEdit: boolean }) {
  const { t } = useTranslation()
  const update = useRoutingUpdate()
  const defaultGroup = groups.find((g) => g.isDefault)
  const DEFAULT = 'default'

  return (
    <section className="grid gap-3" aria-labelledby="routing-lighter">
      <SectionHeading id="routing-lighter">{t('settingsRouting.lighter.heading')}</SectionHeading>
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-[14rem_minmax(0,1fr)] sm:items-start">
        <Select
          value={settings.lighterPathGroupId ?? DEFAULT}
          onValueChange={(v) => update.setLighterPathGroup(v === DEFAULT ? null : v)}
          disabled={!canEdit}
        >
          <SelectTrigger className="w-full" aria-label={t('settingsRouting.lighter.group')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT}>{t('settingsRouting.lighter.useDefault', { group: defaultGroup?.name ?? t('settingsRouting.unknownGroup') })}</SelectItem>
            {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <ul className="grid list-disc gap-1 pl-4 text-sm marker:text-muted-foreground">
          <li>{t('settingsRouting.lighter.rule1')}</li>
          <li>{t('settingsRouting.lighter.rule2')}</li>
          <li>{t('settingsRouting.lighter.rule3')}</li>
        </ul>
      </div>
    </section>
  )
}

/** The built-in no-material-change types (PRD F6). Managers turn each one on or off; they cannot add types. */
export function ChangeTypesSection({ settings, canEdit }: { settings: RoutingSettings; canEdit: boolean }) {
  const { t } = useTranslation()
  const update = useRoutingUpdate()
  const onCount = NO_MATERIAL_CHANGE_TYPES.filter((type) => settings.noMaterialChangeTypes[type]).length

  return (
    <section className="grid gap-3" aria-labelledby="routing-types">
      <div className="grid gap-1">
        <SectionHeading id="routing-types">{t('settingsRouting.types.heading')}</SectionHeading>
        <p className="text-xs text-muted-foreground">{t('settingsRouting.types.help', { on: onCount, total: NO_MATERIAL_CHANGE_TYPES.length })}</p>
      </div>
      <ul className="overflow-hidden rounded-lg border">
        {NO_MATERIAL_CHANGE_TYPES.map((type) => {
          const on = settings.noMaterialChangeTypes[type]
          const id = `nmc-${type}`
          return (
            <li key={type} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b px-3 py-2.5 last:border-b-0">
              <div className="grid gap-0.5">
                <label htmlFor={id} className="text-sm font-medium">{t(`settingsRouting.types.${type}.name`)}</label>
                <p className="text-xs text-muted-foreground">
                  {t(`settingsRouting.types.${type}.check`)}
                  {type === 'block_swap' && <> <Link to="/library/building-blocks" className="text-primary hover:underline">{t('settingsRouting.types.blocksLink')}</Link></>}
                </p>
              </div>
              <span className="flex items-center gap-2 self-start pt-0.5">
                <span className="w-6 text-right text-xs text-muted-foreground">{on ? t('settingsRouting.on') : t('settingsRouting.off')}</span>
                <Switch id={id} checked={on} disabled={!canEdit} onCheckedChange={(v) => update.setChangeType(type, v)} />
              </span>
            </li>
          )
        })}
        {/* Fixed by the product, not a setting: a Manager cannot turn this on. */}
        <li className="flex items-start gap-2 bg-muted/40 px-3 py-2.5">
          <Ban className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="grid gap-0.5">
            <p className="text-sm font-medium">{t('settingsRouting.types.targeting.name')}</p>
            <p className="text-xs text-muted-foreground">{t('settingsRouting.types.targeting.check')}</p>
          </div>
        </li>
      </ul>
    </section>
  )
}
