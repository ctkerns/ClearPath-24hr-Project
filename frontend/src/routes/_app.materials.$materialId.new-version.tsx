import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useMaterials } from '@/components/materials/material-data'
import { useMaterialDetail } from '@/components/review/material-detail-data'
import { SubmissionForm } from '@/components/submission/submission-form'
import { useSubmitMaterial, valuesFromMaterial } from '@/components/submission/submission-model'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/_app/materials/$materialId/new-version')({
  component: NewVersionPage,
})

/** The submit form, filled in from the current version. Submitting creates the next version (PRD F3). */
function NewVersionPage() {
  const { t } = useTranslation()
  const { materialId } = Route.useParams()
  const navigate = useNavigate()
  const materials = useMaterials()
  const detail = useMaterialDetail(materialId)
  const submitMaterial = useSubmitMaterial()
  const material = materials.data?.find((m) => m.id === materialId)

  if (materials.isPending || detail.isPending) return <Skeleton className="mx-auto h-64 w-full max-w-7xl" />
  if (!material) return <p className="mx-auto max-w-7xl font-medium">{t('review.notFound')}</p>

  const next = (detail.data?.version ?? 0) + 1
  const back = () => navigate({ to: '/materials/$materialId', params: { materialId } })

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4">
      <header className="grid gap-2">
        <Link to="/materials/$materialId" params={{ materialId }} className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-3.5" />
          {material.title}
        </Link>
        <h1 className="text-xl font-semibold">{t('page.newVersion')}</h1>
        <p className="text-muted-foreground">{t('submit.versionIntro', { version: next })}</p>
      </header>
      <SubmissionForm
        mode="version"
        versionNumber={next}
        initial={valuesFromMaterial(material, detail.data ?? null)}
        ready
        onCancel={back}
        onSubmit={async (values) => {
          await submitMaterial(values, { material })
          await back()
        }}
      />
    </div>
  )
}
