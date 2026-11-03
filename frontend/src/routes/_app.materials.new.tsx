import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SubmissionForm } from '@/components/submission/submission-form'
import { emptyValues, useSubmitMaterial } from '@/components/submission/submission-model'

export const Route = createFileRoute('/_app/materials/new')({
  component: NewMaterialPage,
})

function NewMaterialPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const submitMaterial = useSubmitMaterial()

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4">
      <header className="grid gap-2">
        <Link to="/materials" className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-3.5" />
          {t('nav.materials')}
        </Link>
        <h1 className="text-xl font-semibold">{t('page.newMaterial')}</h1>
        <p className="text-muted-foreground">{t('submit.intro')}</p>
      </header>
      <SubmissionForm
        mode="new"
        initial={emptyValues}
        ready
        onCancel={() => navigate({ to: '/materials' })}
        onSubmit={async (values) => {
          const id = await submitMaterial(values)
          await navigate({ to: '/materials/$materialId', params: { materialId: id } })
        }}
      />
    </div>
  )
}
