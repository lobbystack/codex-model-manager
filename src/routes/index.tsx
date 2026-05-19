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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/")({ component: App })

const requestLogPageSize = 25

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
  installed?: boolean
  error?: {
    message?: string
  }
}

type RequestLog = {
  id: string
  requestedAt: string
  provider: string
  model: string
  status: "success" | "error"
  statusCode: number
  errorCode: string | null
  errorMessage: string | null
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
}

type RequestLogsResponse = {
  logs: Array<RequestLog>
  total: number
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

function formatLogTime(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return "Unknown"
  }

  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date)
}

function App() {
  const [usage, setUsage] = useState<UsageSummary>(emptyUsage)
  const [requestLogs, setRequestLogs] = useState<Array<RequestLog>>([])
  const [requestLogTotal, setRequestLogTotal] = useState(0)
  const [requestLogPage, setRequestLogPage] = useState(0)
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

  useEffect(() => {
    async function loadRequestLogs() {
      const offset = requestLogPage * requestLogPageSize
      const response = await fetch(
        `/api/usage/logs?range=today&limit=${requestLogPageSize}&offset=${offset}`
      )

      if (response.ok) {
        const data = (await response.json()) as RequestLogsResponse
        setRequestLogs(data.logs)
        setRequestLogTotal(data.total)
      }
    }

    void loadRequestLogs()
  }, [requestLogPage])

  useEffect(() => {
    async function loadInstallStatus() {
      try {
        const response = await fetch("/api/codex/install-config")
        const data = (await response.json()) as InstallConfigResponse

        if (!response.ok || !data.ok) {
          return
        }

        if (data.installed) {
          setInstallStatus("installed")
          setInstallMessage(data.path ? `Installed to ${data.path}` : null)
        }
      } catch {
        // Keep the button actionable if the status check fails.
      }
    }

    void loadInstallStatus()
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
  const requestLogPageCount = Math.max(
    1,
    Math.ceil(requestLogTotal / requestLogPageSize)
  )
  const hasPreviousRequestLogs = requestLogPage > 0
  const hasNextRequestLogs = requestLogPage + 1 < requestLogPageCount

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
            {installStatus === "installing" ? (
              "Installing..."
            ) : installStatus === "installed" ? (
              <>
                <Check className="size-3.5" />
                Config installed
              </>
            ) : (
              "Install config"
            )}
          </Button>
        </div>
      </header>
      <main className="grid w-full flex-1 grid-cols-1 items-start gap-4 p-4 sm:px-6 sm:py-0 md:gap-8">
        <div className="col-span-full grid w-full grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
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

        <section className="col-span-full flex flex-col gap-3">
          <div>
            <h2 className="text-xl font-semibold">Request logs</h2>
            <p className="text-sm text-muted-foreground">
              Recent proxied requests from today.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requestLogs.length > 0 ? (
                requestLogs.map((log) => {
                  const tokens = log.inputTokens + log.outputTokens

                  return (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-xs">
                        {formatLogTime(log.requestedAt)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px]"
                        >
                          {log.provider}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-80 truncate font-mono text-xs">
                        {log.model}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            log.status === "error" ? "destructive" : "secondary"
                          }
                        >
                          {log.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatNumber(tokens)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatUsd(log.estimatedCostUsd)}
                      </TableCell>
                      <TableCell className="max-w-72 truncate text-muted-foreground">
                        {log.errorMessage || log.errorCode || "-"}
                      </TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No requests logged today.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {requestLogTotal > requestLogPageSize && (
            <Pagination className="justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    aria-disabled={!hasPreviousRequestLogs}
                    className={
                      !hasPreviousRequestLogs
                        ? "pointer-events-none opacity-50"
                        : undefined
                    }
                    onClick={(event) => {
                      event.preventDefault()
                      setRequestLogPage((page) => Math.max(0, page - 1))
                    }}
                  />
                </PaginationItem>
                <PaginationItem className="px-2 text-sm text-muted-foreground">
                  Page {requestLogPage + 1} of {requestLogPageCount}
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    aria-disabled={!hasNextRequestLogs}
                    className={
                      !hasNextRequestLogs
                        ? "pointer-events-none opacity-50"
                        : undefined
                    }
                    onClick={(event) => {
                      event.preventDefault()
                      setRequestLogPage((page) =>
                        Math.min(requestLogPageCount - 1, page + 1)
                      )
                    }}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </section>
      </main>
    </>
  )
}
