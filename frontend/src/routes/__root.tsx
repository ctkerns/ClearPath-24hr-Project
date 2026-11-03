import type { QueryClient } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { TooltipProvider } from '@/components/ui/tooltip'

// Layout shared by every page. <Outlet /> renders the current page.
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
})

function RootLayout() {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-h-screen">
        <nav className="flex gap-4 border-b px-6 py-3 text-sm">
          <span className="font-semibold">ClearPath</span>
          <Link to="/" className="[&.active]:font-semibold">Home</Link>
          <Link to="/materials/$materialId" params={{ materialId: '123' }} className="[&.active]:font-semibold">
            Material 123
          </Link>
          <Link to="/design-system" className="ml-auto text-muted-foreground [&.active]:font-semibold [&.active]:text-foreground">Design system</Link>
        </nav>
        <main className="p-6">
          <Outlet />
        </main>
        <TanStackRouterDevtools position="bottom-right" />
        <ReactQueryDevtools buttonPosition="bottom-left" />
      </div>
    </TooltipProvider>
  )
}
