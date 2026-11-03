import { createFileRoute } from '@tanstack/react-router'

// "$materialId" in the file name is a URL parameter: /materials/123, /materials/456, ...
export const Route = createFileRoute('/materials/$materialId')({
  component: MaterialPage,
})

function MaterialPage() {
  const { materialId } = Route.useParams() // typed as string
  return <h1 className="text-2xl font-semibold">Material {materialId}</h1>
}
