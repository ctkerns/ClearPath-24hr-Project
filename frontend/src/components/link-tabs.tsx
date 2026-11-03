import { Link, type LinkProps } from '@tanstack/react-router'
import { activeIndicatorClass, useActiveIndicator } from '@/lib/use-active-indicator'

// Tabs where each tab is its own route (Library, Settings), so a tab has a URL you can share.
// Looks like the line variant of components/ui/tabs; the underline slides to the active tab.
// Later: hide the tabs that the user's role cannot use (the server still checks every request).
export function LinkTabs({ label, tabs }: { label: string; tabs: { to: LinkProps['to']; label: string }[] }) {
  const { containerRef, indicatorRef } = useActiveIndicator<HTMLElement>()
  return (
    <nav ref={containerRef} aria-label={label} className="relative flex gap-1 overflow-x-auto border-b">
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          className="px-2.5 py-1.5 font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground [&.active]:text-foreground"
        >
          {tab.label}
        </Link>
      ))}
      <span
        ref={indicatorRef}
        aria-hidden="true"
        className={activeIndicatorClass}
      />
    </nav>
  )
}
