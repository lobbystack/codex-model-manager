import { createFileRoute } from "@tanstack/react-router"
import {
  AlertTriangle,
  Check,
  CircleDollarSign,
  Hash,
  ReceiptText,
} from "lucide-react"
import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { managedModels } from "@/proxy/model-registry"

export const Route = createFileRoute("/")({ component: App })

type UsageSummary = {
  requests: number
  tokens: number
  estimatedCostUsd: number
  realCostUsd: number
  errorRate: number
}

const emptyUsage: UsageSummary = {
  requests: 0,
  tokens: 0,
  estimatedCostUsd: 0,
  realCostUsd: 0,
  errorRate: 0,
}

type InstallConfigResponse = {
  ok: boolean
  path?: string
  backupPath?: string | null
  error?: {
    message?: string
  }
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(value)
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value)
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("en", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value)
}

function App() {
  const [usage, setUsage] = useState<UsageSummary>(emptyUsage)
  const [installStatus, setInstallStatus] = useState<
    "idle" | "installing" | "installed" | "error"
  >("idle")
  const [installMessage, setInstallMessage] = useState<string | null>(null)

  useEffect(() => {
    async function loadUsage() {
      const usageResponse = await fetch("/api/usage?range=today")

      if (usageResponse.ok) {
        setUsage((await usageResponse.json()) as UsageSummary)
      }
    }

    void loadUsage()
  }, [])

  const installConfig = async () => {
    setInstallStatus("installing")
    setInstallMessage(null)

    try {
      const response = await fetch("/api/codex/install-config", {
        method: "POST",
      })
      const data = (await response.json()) as InstallConfigResponse

      if (!response.ok || !data.ok) {
        throw new Error(data.error?.message || "Unable to install config.")
      }

      setInstallStatus("installed")
      setInstallMessage(`Installed to ${data.path}`)
    } catch (error) {
      setInstallStatus("error")
      setInstallMessage(
        error instanceof Error ? error.message : "Unable to install config."
      )
    }
  }

  const metricCards = [
    {
      title: "Requests",
      value: formatNumber(usage.requests),
      note: "Proxied today",
      icon: ReceiptText,
    },
    {
      title: "Tokens",
      value: formatNumber(usage.tokens),
      note: "Input and output",
      icon: Hash,
    },
    {
      title: "Estimated Cost",
      value: formatUsd(usage.estimatedCostUsd),
      note: "API-equivalent spend",
      icon: CircleDollarSign,
    },
    {
      title: "Real Cost",
      value: formatUsd(usage.realCostUsd),
      note: "Actual user cost",
      icon: CircleDollarSign,
    },
    {
      title: "Error Rate",
      value: formatPercent(usage.errorRate),
      note: "Failed requests",
      icon: AlertTriangle,
    },
  ]

  return (
    <>
      <header className="flex h-14 items-center gap-4 border-b bg-background px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-6 lg:h-[60px]">
        <h1 className="text-lg font-semibold md:text-2xl">Overview</h1>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Proxy Online
          </Badge>
          <Button
            size="sm"
            variant={installStatus === "installed" ? "outline" : "default"}
            className={
              installStatus === "installed"
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
                : undefined
            }
            disabled={installStatus === "installing"}
            title={installMessage || undefined}
            onClick={() => void installConfig()}
          >
            {installStatus === "installing"
              ? "Installing..."
              : installStatus === "installed"
                ? (
                    <>
                      <Check className="size-3.5" />
                      Config installed
                    </>
                  )
                : "Install config"}
          </Button>
        </div>
      </header>
      <main className="grid w-full flex-1 grid-cols-1 items-start gap-4 p-4 sm:px-6 sm:py-0 md:gap-8">
        <div
          className="col-span-full grid w-full gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5"
        >
          {metricCards.map((metric) => {
            const Icon = metric.icon

            return (
              <Card key={metric.title} className="w-full">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {metric.title}
                  </CardTitle>
                  <Icon className="size-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{metric.value}</div>
                  <p className="text-xs text-muted-foreground">{metric.note}</p>
                </CardContent>
              </Card>
            )
          })}
        </div>

        <Card className="col-span-full">
          <CardHeader className="flex flex-row items-center">
            <div className="grid gap-2">
              <CardTitle>Managed Models</CardTitle>
              <CardDescription>
                Configure which models are exposed to the Codex CLI.
              </CardDescription>
            </div>
            <Button size="sm" className="ml-auto gap-1">
              Add Model
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead className="hidden md:table-cell">
                    Capabilities
                  </TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {managedModels.map((model) => (
                  <TableRow key={model.id}>
                    <TableCell>
                      <div className="font-medium">{model.displayName}</div>
                      <div className="hidden font-mono text-xs text-muted-foreground md:inline">
                        {model.id}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="font-mono text-[10px]"
                      >
                        {model.provider}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex gap-1">
                        {model.supportsResponses && (
                          <Badge variant="secondary" className="text-[10px]">
                            Responses
                          </Badge>
                        )}
                        {model.supportsChatCompletions && (
                          <Badge variant="secondary" className="text-[10px]">
                            Chat
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Switch
                        checked={model.enabled}
                        aria-label="Toggle model status"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </>
  )
}
