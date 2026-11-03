import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// The file path (routes/index.tsx) makes this the "/" page
export const Route = createFileRoute('/')({
  component: HomePage,
})

type Hello = { message: string }

function HomePage() {
  const [count, setCount] = useState(0)

  // Loads public/hello.json. Later this becomes a FastAPI endpoint.
  const hello = useQuery({
    queryKey: ['hello'],
    queryFn: async (): Promise<Hello> => {
      const res = await fetch('/hello.json')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
  })

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Hello, world</CardTitle>
        <CardDescription>Vite + React + TanStack + Tailwind + shadcn</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">
          From TanStack Query:{' '}
          {hello.isPending ? 'Loading…' : hello.isError ? hello.error.message : hello.data.message}
        </p>
        <Button onClick={() => setCount((c) => c + 1)}>Clicked {count} times</Button>
      </CardContent>
    </Card>
  )
}
