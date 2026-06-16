import { Link, useLocation } from "@tanstack/react-router"
import { Activity, BarChart3, Box, Layers, Terminal } from "lucide-react"
import { useEffect, useState } from "react"

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

type UpdateCheckResponse = {
  ok: boolean
  latestVersion?: string
  updateAvailable: boolean
  supported?: boolean
  error?: {
    message?: string
  }
}

type ApplyUpdateResponse = {
  ok: boolean
  changed?: boolean
  version?: string
  restartScheduled?: boolean
  error?: {
    message?: string
  }
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResponse | null>(null)
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "available" | "applying" | "restarting" | "error"
  >("idle")

  const navItems = [
    { href: "/", label: "Overview", icon: Activity },
    { href: "/usage", label: "Usage", icon: BarChart3 },
    { href: "/models", label: "Models", icon: Layers },
    { href: "/providers", label: "Providers", icon: Box },
  ]

  useEffect(() => {
    async function checkForUpdates() {
      try {
        const response = await fetch("/api/system/update/check")
        const data = (await response.json()) as UpdateCheckResponse

        if (!response.ok || !data.ok || !data.updateAvailable) {
          return
        }

        setUpdateInfo(data)
        setUpdateStatus("available")
      } catch {
        // Update checks should never interrupt navigation.
      }
    }

    void checkForUpdates()
  }, [])

  const applyUpdate = async () => {
    setUpdateStatus("applying")

    try {
      const response = await fetch("/api/system/update/apply", {
        method: "POST",
      })
      const data = (await response.json()) as ApplyUpdateResponse

      if (!response.ok || !data.ok) {
        throw new Error(data.error?.message || "Unable to apply update.")
      }

      setUpdateStatus(data.restartScheduled ? "restarting" : "idle")
      setUpdateInfo(null)
    } catch {
      setUpdateStatus("error")
    }
  }

  return (
    <div className="flex min-h-svh w-full bg-background">
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
              const isActive =
                item.href === "/"
                  ? location.pathname === "/"
                  : location.pathname.startsWith(item.href)
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
        {updateInfo && (
          <div className="p-4">
            <Alert>
              <AlertTitle>Update available</AlertTitle>
              <AlertDescription>
                {updateInfo.latestVersion
                  ? `Version ${updateInfo.latestVersion}`
                  : "A new version is ready."}
              </AlertDescription>
              <AlertAction>
                <Button
                  size="sm"
                  disabled={
                    updateInfo.supported === false ||
                    updateStatus === "applying" ||
                    updateStatus === "restarting"
                  }
                  onClick={() => void applyUpdate()}
                >
                  {updateStatus === "applying" ? "Updating" : "Update"}
                </Button>
              </AlertAction>
            </Alert>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <div className="flex w-full min-w-0 flex-1 flex-col sm:pl-64">
        {children}
      </div>
    </div>
  )
}
