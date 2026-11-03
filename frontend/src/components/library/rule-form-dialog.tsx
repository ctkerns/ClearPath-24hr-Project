import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Channel, Product } from '@/components/materials/material-data'
import { SaveError } from '@/components/save-error'
import { Segmented } from '@/components/settings/routing-fields'
import { useLicensedStates } from '@/components/settings/workspace-data'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { RiskLevel } from '@/components/ui/risk-tag'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useSave } from '@/lib/use-save'
import { FlagPreview } from './affected-materials'
import { useDisclosures } from './disclosure-data'
import { useRuleEditPreview } from './impact-data'
import { dateFromToday, focusFirstInvalid, isWebUrl, MAX_LIST, MAX_LONG, MAX_NOTE, MAX_SHORT, MAX_URL, splitLines, TEXT_ID } from './form-utils'
import { ChannelChips, FieldError, FieldHint, ProductChips } from './library-fields'
import {
  CHECK_LAYERS,
  CODE_CHECK_TYPES,
  RULE_KINDS,
  ruleIdTaken,
  useRuleUpdate,
  useRules,
  type CheckLayer,
  type CodeCheckType,
  type Rule,
  type RuleCheck,
  type RuleInput,
  type RuleKind,
} from './rule-data'

const SEVERITIES: RiskLevel[] = ['low', 'medium', 'high']

/**
 * Add a rule, or edit one as a new version (PRD F7, F8 company rules; Managers only, R3).
 * The server keeps every version; the note says what changed.
 */
export function RuleFormDialog({ rule, open, onClose, onCreated }: {
  /** The rule to edit. Leave it out to add a rule. */
  rule?: Rule
  open: boolean
  onClose: () => void
  onCreated?: (rule: Rule) => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {/* Mounted only while open, so each time starts from the saved rule. */}
        {open && <RuleForm rule={rule} onClose={onClose} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  )
}

/** The form keeps the inputs of every check type, so switching type and back loses nothing. */
type Draft = {
  id: string
  title: string
  kind: RuleKind
  text: string
  jurisdiction: string
  products: Product[]
  channels: Channel[]
  citationLabel: string
  citationUrl: string
  severity: RiskLevel
  layer: CheckLayer
  checkType: CodeCheckType
  terms: string
  phrases: string
  disclosure: string
  guidance: string
  effectiveDate: string
  note: string
}

function draftOf(rule?: Rule): Draft {
  const c = rule?.check
  return {
    id: '',
    title: rule?.title ?? '',
    kind: rule?.kind ?? 'regulation',
    text: rule?.text ?? '',
    jurisdiction: rule?.jurisdiction ?? 'federal',
    products: rule?.products ?? [],
    channels: rule?.channels ?? [],
    citationLabel: rule?.citation?.label ?? '',
    citationUrl: rule?.citation?.url ?? '',
    severity: rule?.severity ?? 'medium',
    layer: rule?.layer ?? 'code',
    checkType: c && c.type !== 'ai' ? c.type : 'phrase_banned',
    terms: c?.type === 'trigger_terms' ? c.terms.join('\n') : '',
    phrases: c?.type === 'phrase_required' || c?.type === 'phrase_banned' ? c.phrases.join('\n') : '',
    disclosure: c && 'disclosure' in c ? c.disclosure : '',
    guidance: c?.type === 'ai' ? c.guidance : '',
    // A new version usually keeps the date; the Manager changes it when the new text starts later.
    effectiveDate: rule?.effectiveDate ?? dateFromToday(0),
    note: '',
  }
}

/** The check the server stores, from the inputs of the picked type. */
function checkOf(d: Draft): RuleCheck {
  if (d.layer === 'ai') return { type: 'ai', guidance: d.guidance.trim() }
  switch (d.checkType) {
    case 'trigger_terms': return { type: 'trigger_terms', terms: splitLines(d.terms), disclosure: d.disclosure }
    case 'required_disclosure': return { type: 'required_disclosure', disclosure: d.disclosure }
    case 'phrase_required': return { type: 'phrase_required', phrases: splitLines(d.phrases) }
    case 'phrase_banned': return { type: 'phrase_banned', phrases: splitLines(d.phrases) }
    case 'rate_sheet': return { type: 'rate_sheet' }
    case 'hidden_text': return { type: 'hidden_text' }
  }
}

function RuleForm({ rule, onClose, onCreated }: { rule?: Rule; onClose: () => void; onCreated?: (rule: Rule) => void }) {
  const { t } = useTranslation()
  const rules = useRules()
  const disclosures = useDisclosures()
  const licensed = useLicensedStates()
  const update = useRuleUpdate()
  const save = useSave(onClose)
  const [d, setD] = useState(() => draftOf(rule))
  const [tried, setTried] = useState(false)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD((prev) => ({ ...prev, [key]: value }))

  // Federal, every state (company rules), then the licensed states. A rule's own state stays even if no longer licensed.
  const jurisdictions = ['federal', 'all', ...licensed, ...(d.jurisdiction.length === 2 && !licensed.includes(d.jurisdiction) ? [d.jurisdiction] : [])]
  const jurisdictionLabel = (j: string) => (j === 'federal' ? t('rules.federal') : j === 'all' ? t('rules.allStates') : j)

  // An edit flags the approved materials that depend on the rule before or after it (F7). The server previews them.
  const preview = useRuleEditPreview(
    rule?.id,
    d.effectiveDate ? { jurisdiction: d.jurisdiction, products: d.products, channels: d.channels, effectiveDate: d.effectiveDate } : undefined,
  )

  const check = checkOf(d)
  const list = check.type === 'trigger_terms' ? check.terms : check.type === 'phrase_required' || check.type === 'phrase_banned' ? check.phrases : undefined
  const required = t('rules.editor.required')
  const hasLabel = !!d.citationLabel.trim()
  const hasUrl = !!d.citationUrl.trim()
  const errors = {
    id: rule ? undefined
      : !d.id.trim() ? required
      : !TEXT_ID.test(d.id.trim()) ? t('rules.editor.idInvalid')
      : ruleIdTaken(rules.data ?? [], d.id) ? t('rules.editor.idTaken')
      : undefined,
    title: d.title.trim() ? undefined : required,
    text: d.text.trim() ? undefined : required,
    citation: hasLabel !== hasUrl ? t('rules.editor.citationIncomplete') : hasUrl && !isWebUrl(d.citationUrl) ? t('rules.editor.urlInvalid') : undefined,
    list: list === undefined ? undefined
      : list.length === 0 ? t('rules.editor.listMissing')
      : list.length > MAX_LIST || list.some((x) => x.length > MAX_SHORT) ? t('rules.editor.listTooLong')
      : undefined,
    disclosure: 'disclosure' in check && !check.disclosure ? t('rules.editor.disclosureMissing') : undefined,
    guidance: check.type === 'ai' && !check.guidance ? required : undefined,
    effectiveDate: d.effectiveDate ? undefined : required,
    note: d.note.trim() ? undefined : required,
  }
  const ready = Object.values(errors).every((e) => !e)
  // The ID is checked as the Manager types, because a taken ID is easy to miss. The rest shows after Save.
  const show = (key: keyof typeof errors) => (tried || (key === 'id' && d.id.trim()) ? errors[key] : undefined)
  const described = (key: keyof typeof errors, hint?: boolean) => (show(key) || hint ? `rule-${key}-hint` : undefined)

  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        setTried(true)
        if (!ready) focusFirstInvalid(e.currentTarget)
        if (!ready || save.pending) return
        const input: RuleInput = {
          title: d.title.trim(),
          kind: d.kind,
          text: d.text.trim(),
          jurisdiction: d.jurisdiction,
          products: d.products,
          channels: d.channels,
          citation: hasLabel ? { label: d.citationLabel.trim(), url: d.citationUrl.trim() } : null,
          effectiveDate: d.effectiveDate,
          severity: d.severity,
          layer: d.layer,
          check,
          note: d.note.trim(),
        }
        void save.run(async () => {
          if (rule) await update.edit(rule.id, input)
          else onCreated?.(await update.create(d.id.trim(), input))
        })
      }}
    >
      <DialogHeader>
        <DialogTitle>{t(rule ? 'rules.editor.editTitle' : 'rules.editor.newTitle')}</DialogTitle>
        <DialogDescription>
          {rule ? t('rules.editor.editDescription', { version: rule.version + 1 }) : t('rules.editor.newDescription')}
        </DialogDescription>
      </DialogHeader>

      {!rule && (
        <div className="grid gap-1.5">
          <Label htmlFor="rule-id">{t('rules.editor.id')}</Label>
          <Input
            id="rule-id"
            value={d.id}
            onChange={(e) => set('id', e.target.value)}
            maxLength={64}
            className="w-56 font-mono"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!show('id') || undefined}
            aria-describedby="rule-id-hint"
            autoFocus
          />
          {show('id') ? <FieldError id="rule-id-hint">{show('id')}</FieldError> : <FieldHint id="rule-id-hint">{t('rules.editor.idHint')}</FieldHint>}
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="rule-title">{t('rules.editor.title')}</Label>
        <Input
          id="rule-title"
          value={d.title}
          onChange={(e) => set('title', e.target.value)}
          maxLength={MAX_SHORT}
          aria-invalid={!!show('title') || undefined}
          aria-describedby={described('title')}
          autoFocus={!!rule}
        />
        {show('title') && <FieldError id="rule-title-hint">{show('title')}</FieldError>}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="rule-text">{t('rules.editor.text')}</Label>
        <Textarea
          id="rule-text"
          value={d.text}
          onChange={(e) => set('text', e.target.value)}
          rows={4}
          maxLength={MAX_LONG}
          aria-invalid={!!show('text') || undefined}
          aria-describedby={described('text')}
        />
        {show('text') && <FieldError id="rule-text-hint">{show('text')}</FieldError>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-1.5">
          <span className="text-sm font-medium">{t('rules.editor.kind')}</span>
          <Segmented<RuleKind>
            label={t('rules.editor.kind')}
            value={d.kind}
            onChange={(v) => set('kind', v)}
            options={RULE_KINDS.map((k) => ({ value: k, label: t(`rules.kind.${k}`) }))}
          />
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="rule-jurisdiction">{t('rules.editor.jurisdiction')}</Label>
          <Select value={d.jurisdiction} onValueChange={(v) => set('jurisdiction', v)}>
            <SelectTrigger id="rule-jurisdiction" className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {jurisdictions.map((j) => <SelectItem key={j} value={j}>{jurisdictionLabel(j)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-1.5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="rule-citation">{t('rules.editor.citation')}</Label>
            <Input
              id="rule-citation"
              value={d.citationLabel}
              onChange={(e) => set('citationLabel', e.target.value)}
              maxLength={MAX_SHORT}
              placeholder={t('rules.editor.citationPlaceholder')}
              aria-invalid={(!!show('citation') && !hasLabel) || undefined}
              aria-describedby="rule-citation-hint"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rule-citation-url">{t('rules.editor.citationUrl')}</Label>
            <Input
              id="rule-citation-url"
              type="url"
              value={d.citationUrl}
              onChange={(e) => set('citationUrl', e.target.value)}
              maxLength={MAX_URL}
              placeholder="https://"
              aria-invalid={(!!show('citation') && (!hasUrl || !isWebUrl(d.citationUrl))) || undefined}
              aria-describedby="rule-citation-hint"
            />
          </div>
        </div>
        {show('citation') ? <FieldError id="rule-citation-hint">{show('citation')}</FieldError> : <FieldHint id="rule-citation-hint">{t('rules.editor.citationHint')}</FieldHint>}
      </div>

      <ProductChips value={d.products} onChange={(v) => set('products', v)} />
      <ChannelChips value={d.channels} onChange={(v) => set('channels', v)} />

      <div className="grid gap-1.5">
        <span className="text-sm font-medium">{t('rules.editor.severity')}</span>
        <Segmented<RiskLevel>
          label={t('rules.editor.severity')}
          value={d.severity}
          onChange={(v) => set('severity', v)}
          options={SEVERITIES.map((s) => ({ value: s, label: t(`level.${s}`) }))}
        />
        <FieldHint>{t('rules.editor.severityHint')}</FieldHint>
      </div>

      {/* F4: layer 1 is code checks, layer 2 is the AI review. Each rule says which one checks it. */}
      <fieldset className="grid gap-4 rounded-md border px-3 pt-2 pb-3">
        <legend className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('rules.editor.layer')}</legend>
        <Segmented<CheckLayer>
          label={t('rules.editor.layer')}
          value={d.layer}
          onChange={(v) => set('layer', v)}
          options={CHECK_LAYERS.map((l) => ({ value: l, label: t(`rules.layer.${l}`) }))}
        />

        {d.layer === 'code' && (
          <div className="grid gap-1.5">
            <Label htmlFor="rule-check-type">{t('rules.editor.checkType')}</Label>
            <Select value={d.checkType} onValueChange={(v) => set('checkType', v as CodeCheckType)}>
              <SelectTrigger id="rule-check-type" className="w-72 max-w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CODE_CHECK_TYPES.map((c) => <SelectItem key={c} value={c}>{t(`rules.editor.checkTypes.${c}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {list !== undefined && (
          <div className="grid gap-1.5">
            <Label htmlFor="rule-list">{t(check.type === 'trigger_terms' ? 'rules.editor.terms' : 'rules.editor.phrases')}</Label>
            <Textarea
              id="rule-list"
              value={check.type === 'trigger_terms' ? d.terms : d.phrases}
              onChange={(e) => set(check.type === 'trigger_terms' ? 'terms' : 'phrases', e.target.value)}
              rows={4}
              className="font-mono text-xs md:text-xs"
              spellCheck={false}
              aria-invalid={!!show('list') || undefined}
              aria-describedby="rule-list-hint"
            />
            {show('list') ? <FieldError id="rule-list-hint">{show('list')}</FieldError> : <FieldHint id="rule-list-hint">{t('rules.editor.listHint')}</FieldHint>}
          </div>
        )}

        {'disclosure' in check && (
          <div className="grid gap-1.5">
            <Label htmlFor="rule-disclosure">{t('rules.editor.disclosure')}</Label>
            <Select value={d.disclosure || undefined} onValueChange={(v) => set('disclosure', v)}>
              <SelectTrigger
                id="rule-disclosure"
                className="w-full"
                aria-invalid={!!show('disclosure') || undefined}
                aria-describedby={described('disclosure')}
              >
                <SelectValue placeholder={t('rules.editor.disclosurePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {(disclosures.data ?? []).map((x) => <SelectItem key={x.id} value={x.id}>{x.title}</SelectItem>)}
              </SelectContent>
            </Select>
            {show('disclosure') && <FieldError id="rule-disclosure-hint">{show('disclosure')}</FieldError>}
          </div>
        )}

        {check.type === 'ai' && (
          <div className="grid gap-1.5">
            <Label htmlFor="rule-guidance">{t('rules.editor.guidance')}</Label>
            <Textarea
              id="rule-guidance"
              value={d.guidance}
              onChange={(e) => set('guidance', e.target.value)}
              rows={4}
              maxLength={MAX_LONG}
              aria-invalid={!!show('guidance') || undefined}
              aria-describedby="rule-guidance-hint"
            />
            {show('guidance') ? <FieldError id="rule-guidance-hint">{show('guidance')}</FieldError> : <FieldHint id="rule-guidance-hint">{t('rules.editor.guidanceHint')}</FieldHint>}
          </div>
        )}
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor="rule-effective">{t('rules.editor.effectiveDate')}</Label>
        <Input
          id="rule-effective"
          type="date"
          value={d.effectiveDate}
          onChange={(e) => set('effectiveDate', e.target.value)}
          className="w-44"
          aria-invalid={!!show('effectiveDate') || undefined}
          aria-describedby={described('effectiveDate')}
        />
        {show('effectiveDate') && <FieldError id="rule-effectiveDate-hint">{show('effectiveDate')}</FieldError>}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="rule-note">{t('rules.editor.note')}</Label>
        <Textarea
          id="rule-note"
          value={d.note}
          onChange={(e) => set('note', e.target.value)}
          rows={2}
          maxLength={MAX_NOTE}
          placeholder={t(rule ? 'rules.editor.notePlaceholderEdit' : 'rules.editor.notePlaceholderNew')}
          aria-invalid={!!show('note') || undefined}
          aria-describedby="rule-note-hint"
        />
        {show('note') ? <FieldError id="rule-note-hint">{show('note')}</FieldError> : <FieldHint id="rule-note-hint">{t('rules.editor.noteHint')}</FieldHint>}
      </div>

      {rule && <FlagPreview preview={preview} />}
      <SaveError error={save.error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t('rules.editor.cancel')}</Button>
        <Button type="submit" disabled={save.pending}>
          {rule ? t('rules.editor.save', { version: rule.version + 1 }) : t('rules.editor.create')}
        </Button>
      </DialogFooter>
    </form>
  )
}
