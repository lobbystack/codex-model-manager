import { Link, useLocation } from "@tanstack/react-router"
import { Activity, Box, Layers, Terminal } from "lucide-react"

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation()

  const navItems = [
    { href: "/", label: "Overview", icon: Activity },
    { href: "/models", label: "Models", icon: Layers },
    { href: "/providers", label: "Providers", icon: Box },
  ]

  return (
    <div className="flex min-h-svh w-full bg-muted/20">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-10 hidden w-64 flex-col border-r bg-background sm:flex">
        <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <Terminal className="size-5" />
            <span className="">Codex Manager</span>
          </Link>
        </div>
        <div className="flex-1 overflow-auto py-2">
          <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = location.pathname === item.href
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary ${
                    isActive ? "bg-muted text-primary" : "text-muted-foreground"
                  }`}
                >
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col sm:pl-64 w-full">{children}</div>
    </div>
  )
}
