import { FileUp, Globe, ImageIcon, Lock, Paperclip, PenLine, Route as RouteIcon, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CHANNELS, PRODUCTS, type Channel, type Product } from '@/components/materials/material-data'
import { ChannelIcon } from '@/components/materials/material-meta'
import { useOptionLabel } from '@/components/materials/use-option-label'
import { SaveError } from '@/components/save-error'
import { useLicensedStates } from '@/components/settings/workspace-data'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/api'
import { useSave } from '@/lib/use-save'
import { cn } from '@/lib/utils'
import {
  useChannelFields,
  useRoutingPreview,
  validate,
  type ContentSource,
  type SubmissionValues,
  type UploadedFile,
  uploadFile,
} from './submission-model'
import { FixesPanel } from './fixes-panel'
import { useReviewFixes, type AppliedFix, type ReviewFixes } from './review-fixes'

/**
 * The submit form (PRD F3). One component for a new material and for a new version:
 * a new version starts from the current content, and its title and channel are locked,
 * because a version belongs to one material on one channel.
 */
export function SubmissionForm({ initial, mode, materialId, versionNumber, ready, onSubmit, onCancel, review, initialApplied }: {
  initial: SubmissionValues
  /** For a new version: the fixes from the review of the current version, shown beside the fields. */
  review?: ReviewFixes
  /** The fixes that `initial` already has applied ("Fix in a new version" on the review page). */
  initialApplied?: Record<string, AppliedFix>
  mode: 'new' | 'version'
  /** The material that gets a new version, so the routing preview uses its channel and affiliate. */
  materialId?: string
  /** The number the new version gets, for the submit button. */
  versionNumber?: number
  /** False until the data that the submit needs has loaded. */
  ready: boolean
  /** Sends the submission. When it fails, the form shows the server's message and keeps the values. */
  onSubmit: (values: SubmissionValues) => Promise<unknown>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const label = useOptionLabel()
  const [values, setValues] = useState(initial)
  // Errors show only after the first submit attempt, so the form does not scold while you type.
  const [tried, setTried] = useState(false)
  const isVersion = mode === 'version'
  const errors = validate(values, isVersion)
  const shown = tried ? errors : {}
  const set = <K extends keyof SubmissionValues>(key: K, value: SubmissionValues[K]) => setValues((v) => ({ ...v, [key]: value }))
  // Licensed states and routing come from Settings (Workspace and Routing tabs), so a change there shows here at once.
  const licensedStates = useLicensedStates()
  const save = useSave(() => {})
  const channelFields = useChannelFields()
  // A preview from the server; the server decides again on submit (PRD R2, F6).
  const routing = useRoutingPreview(values, materialId)
  const fixState = useReviewFixes(review?.fixes ?? [], initialApplied ?? {}, values.fields, (fields) => set('fields', fields))
  const hasFixes = !!review && review.fixes.length + review.manual.length > 0

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (Object.keys(errors).length === 0 && ready && !save.pending) void save.run(() => onSubmit(values))
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-6">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Left: what the material says. */}
        <section className="grid gap-4" aria-labelledby="content-heading">
          <h2 id="content-heading" className="sr-only">{t('submit.content')}</h2>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
            <Field id="title" label={t('submit.title')} error={shown.title} locked={isVersion}>
              <Input id="title" value={values.title} onChange={(e) => set('title', e.target.value)} disabled={isVersion} placeholder={t('submit.titlePlaceholder')} aria-invalid={!!shown.title} />
            </Field>
            <Field id="channel" label={t('submit.channel')} error={shown.channel} locked={isVersion}>
              <Select value={values.channel} onValueChange={(c) => set('channel', c as Channel)} disabled={isVersion}>
                <SelectTrigger id="channel" className="w-full" aria-invalid={!!shown.channel}>
                  <SelectValue placeholder={t('submit.choose')} />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}><ChannelIcon channel={c} />{label('channel', c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="rounded-lg border">
            <div role="tablist" aria-label={t('submit.sourceLabel')} className="flex gap-1 border-b bg-muted px-2 pt-2">
              {([['text', PenLine], ['file', FileUp], ['url', Globe]] as const).map(([source, Icon]) => (
                <button
                  key={source}
                  type="button"
                  role="tab"
                  aria-selected={values.source === source}
                  onClick={() => set('source', source as ContentSource)}
                  className={cn(
                    '-mb-px flex items-center gap-1.5 rounded-t-md border border-transparent px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground',
                    'aria-selected:border-border aria-selected:border-b-background aria-selected:bg-background aria-selected:text-foreground',
                  )}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {t(`submit.source.${source}`)}
                </button>
              ))}
            </div>
            <div className="grid gap-4 p-4">
              {values.source === 'text' && (
                !values.channel ? (
                  <p className="text-muted-foreground">{t('submit.chooseChannelFirst')}</p>
                ) : !channelFields ? (
                  <Skeleton className="h-24 w-full" />
                ) : (
                  channelFields[values.channel].map((f) => (
                    <div key={f.label} className="grid gap-1.5">
                      <Label htmlFor={`field-${f.label}`} className="text-xs text-muted-foreground">
                        {f.kind === 'image' ? t('submit.textInImage') : f.label}
                      </Label>
                      {f.kind === 'image' && <FileDrop id={`image-${f.label}`} accept="image/*" multiple={false} icon={ImageIcon} files={values.imageFiles} onFiles={(files) => set('imageFiles', files)} hint={t('submit.imageHint')} />}
                      {f.multiline || f.kind === 'image' ? (
                        <Textarea id={`field-${f.label}`} value={values.fields[f.label] ?? ''} onChange={(e) => set('fields', { ...values.fields, [f.label]: e.target.value })} className="min-h-20" />
                      ) : (
                        <Input id={`field-${f.label}`} value={values.fields[f.label] ?? ''} onChange={(e) => set('fields', { ...values.fields, [f.label]: e.target.value })} />
                      )}
                    </div>
                  ))
                )
              )}
              {values.source === 'file' && (
                <FileDrop id="content-files" accept="image/*,application/pdf" multiple icon={FileUp} files={values.files} onFiles={(files) => set('files', files)} hint={t('submit.fileHint')} />
              )}
              {values.source === 'url' && (
                <div className="grid gap-1.5">
                  <Label htmlFor="content-url">{t('submit.contentUrl')}</Label>
                  <Input id="content-url" type="url" inputMode="url" placeholder="https://" value={values.contentUrl} onChange={(e) => set('contentUrl', e.target.value)} />
                  <p className="text-xs text-muted-foreground">{t('submit.contentUrlHelp')}</p>
                </div>
              )}
              {shown.content && <p className="text-xs font-medium text-destructive">{t(shown.content as 'submit.errors.title')}</p>}
            </div>
          </div>
        </section>

        {/* Right: the facts that decide the checklist and the routing. */}
        <aside className="grid gap-4 lg:sticky lg:top-24">
          {hasFixes && values.source === 'text' && <FixesPanel review={review} state={fixState} fields={values.fields} />}
          <Field id="product" label={t('submit.product')} error={shown.product}>
            <Select value={values.product} onValueChange={(p) => set('product', p as Product)}>
              <SelectTrigger id="product" className="w-full" aria-invalid={!!shown.product}>
                <SelectValue placeholder={t('submit.choose')} />
              </SelectTrigger>
              <SelectContent>
                {PRODUCTS.map((p) => <SelectItem key={p} value={p}>{label('product', p)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-sm font-medium">{t('submit.states')}</legend>
            <label className="flex items-center gap-2">
              <Checkbox checked={values.nationwide} onCheckedChange={(c) => set('nationwide', c === true)} />
              {t('submit.nationwide')}
            </label>
            {!values.nationwide && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('submit.statesPick')}>
                {licensedStates.map((s) => {
                  const on = values.states.includes(s)
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set('states', on ? values.states.filter((x) => x !== s) : [...values.states, s])}
                      className="h-7 min-w-10 rounded-md border px-2 font-mono text-xs hover:border-muted-foreground aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary-strong"
                    >
                      {s}
                    </button>
                  )
                })}
              </div>
            )}
            <p className="text-xs text-muted-foreground">{values.nationwide ? t('submit.nationwideHelp') : t('submit.statesHelp')}</p>
            {shown.states && <p className="text-xs font-medium text-destructive">{t('submit.errors.states')}</p>}
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <Field id="launch" label={t('submit.launchDate')}>
              <Input id="launch" type="date" value={values.launchDate} onChange={(e) => set('launchDate', e.target.value)} />
            </Field>
            <Field id="end" label={t('submit.endDate')} error={shown.endDate}>
              <Input id="end" type="date" value={values.endDate} onChange={(e) => set('endDate', e.target.value)} aria-invalid={!!shown.endDate} />
            </Field>
          </div>

          <Field id="destination" label={t('submit.destinationUrl')} optional>
            <Input id="destination" value={values.destinationUrl} onChange={(e) => set('destinationUrl', e.target.value)} placeholder="clearpathcu.example/…" />
          </Field>

          <Field id="targeting" label={t('submit.targeting')} optional>
            <Textarea id="targeting" value={values.targeting} onChange={(e) => set('targeting', e.target.value)} placeholder={t('submit.targetingPlaceholder')} className="min-h-16" />
          </Field>

          <div className="grid gap-1.5">
            <span className="text-sm font-medium">{t('submit.proof')} <span className="font-normal text-muted-foreground">{t('submit.optional')}</span></span>
            <FileDrop id="proof-files" multiple icon={Paperclip} files={values.proofFiles} onFiles={(files) => set('proofFiles', files)} hint={t('submit.proofHint')} compact />
          </div>

          {/* Shows who will review before you submit, so the routing is never a surprise. */}
          <div className="grid gap-1.5 rounded-md bg-muted px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-xs font-semibold"><RouteIcon className="size-3.5" aria-hidden="true" />{t('submit.routing')}</p>
            {routing.length ? (
              <ul className="grid gap-0.5 text-xs">
                {routing.map((g) => (
                  <li key={g.name}><span className="font-medium">{g.name}</span> <span className="text-muted-foreground">· {g.reason}</span></li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">{t('submit.routingEmpty')}</p>
            )}
          </div>
        </aside>
      </div>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        {tried && Object.keys(errors).length > 0 && (
          <p className="mr-auto text-xs font-medium text-destructive">{t('submit.fixErrors', { count: Object.keys(errors).length })}</p>
        )}
        <SaveError error={save.error} />
        <Button type="button" variant="outline" onClick={onCancel}>{t('submit.cancel')}</Button>
        <Button type="submit" disabled={!ready || save.pending}>
          {isVersion ? t('submit.submitVersion', { version: versionNumber }) : t('submit.submit')}
        </Button>
      </div>
    </form>
  )
}

function Field({ id, label, error, locked, optional, children }: {
  id: string
  label: string
  error?: string
  locked?: boolean
  optional?: boolean
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id} className="flex items-center gap-1.5">
        {label}
        {optional && <span className="font-normal text-muted-foreground">{t('submit.optional')}</span>}
        {locked && <Lock className="size-3 text-muted-foreground" aria-label={t('submit.locked')} />}
      </Label>
      {children}
      {error && <p className="text-xs font-medium text-destructive">{t(error as 'submit.errors.title')}</p>}
    </div>
  )
}

/** A drop zone that is also a file button. Each file uploads as soon as it is picked (POST /api/materials/files). */
function FileDrop({ id, accept, multiple, icon: Icon, files, onFiles, hint, compact }: {
  id: string
  accept?: string
  multiple: boolean
  icon: typeof FileUp
  files: UploadedFile[]
  onFiles: (files: UploadedFile[]) => void
  hint: string
  compact?: boolean
}) {
  const { t } = useTranslation()
  const [over, setOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string>()
  const add = async (list: FileList | null) => {
    const picked = [...(list ?? [])].slice(0, multiple ? undefined : 1)
    if (!picked.length) return
    setUploading(true)
    setError(undefined)
    try {
      const uploaded = await Promise.all(picked.map(uploadFile))
      onFiles(multiple ? [...files, ...uploaded] : uploaded)
    } catch (err) {
      setError(err instanceof ApiError && err.status < 500 ? err.detail : t('submit.uploadFailed'))
    } finally {
      setUploading(false)
    }
  }
  return (
    <div className="grid gap-1.5">
      <label
        htmlFor={id}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void add(e.dataTransfer.files) }}
        className={cn(
          'flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-input text-xs text-muted-foreground transition-colors hover:border-muted-foreground hover:text-foreground',
          'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring',
          compact ? 'px-3 py-2.5' : 'flex-col px-4 py-6',
          over && 'border-primary bg-primary-soft text-primary-strong',
        )}
      >
        <Icon className={compact ? 'size-4' : 'size-5'} strokeWidth={1.5} aria-hidden="true" />
        {uploading ? (
          <span>{t('submit.uploading')}</span>
        ) : (
          <span><span className="font-semibold text-primary">{t('submit.chooseFile')}</span> {t('submit.orDrop')}</span>
        )}
        {!compact && <span className="text-[11px]">{hint}</span>}
        <input id={id} type="file" accept={accept} multiple={multiple} disabled={uploading} className="sr-only" onChange={(e) => { void add(e.target.files); e.target.value = '' }} />
      </label>
      <SaveError error={error} />
      {files.length > 0 && (
        <ul className="grid gap-1">
          {files.map(({ id: fileId, name }) => (
            <li key={fileId} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
              <Paperclip className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <button type="button" onClick={() => onFiles(files.filter((f) => f.id !== fileId))} aria-label={t('submit.removeFile', { name })} className="text-muted-foreground hover:text-foreground">
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
