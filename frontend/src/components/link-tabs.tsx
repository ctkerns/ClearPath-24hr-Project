import { Link, type LinkProps } from '@tanstack/react-router'

// Tabs where each tab is its own route (Library, Settings), so a tab has a URL you can share.
// Looks like the line variant of components/ui/tabs.
// Later: hide the tabs that the user's role cannot use (the server still checks every request).
export function LinkTabs({ label, tabs }: { label: string; tabs: { to: LinkProps['to']; label: string }[] }) {
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto border-b">
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          className="relative -mb-px border-b-2 border-transparent px-2.5 py-1.5 font-medium whitespace-nowrap text-muted-foreground hover:text-foreground [&.active]:border-primary [&.active]:text-foreground"
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
