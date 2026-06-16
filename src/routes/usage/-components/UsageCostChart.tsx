import { ChevronLeft, ChevronRight } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import type { UsageCostSeries } from "@/server/usage/types"
import type { ChartConfig } from "@/components/ui/chart"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const chartColorKeys = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
] as const

function formatUsd(value: number) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value)
}

function formatMonthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1))
}

function formatDayLabel(date: string) {
  const parsed = new Date(`${date}T12:00:00`)

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
  }).format(parsed)
}

function currentMonthCursor() {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

function isAfterCurrentMonth(year: number, month: number) {
  const now = currentMonthCursor()
  return year > now.year || (year === now.year && month > now.month)
}

function buildChartConfig(models: UsageCostSeries["models"]): ChartConfig {
  const config: ChartConfig = {}

  models.forEach((entry, index) => {
    const colorKey = chartColorKeys[index % chartColorKeys.length]
    config[entry.model] = {
      label: entry.model,
      color: `var(${colorKey})`,
    }
  })

  return config
}

function buildChartData(series: UsageCostSeries) {
  return series.days.map((day) => {
    const row: Record<string, string | number> = {
      date: day.date,
      label: formatDayLabel(day.date),
      totalUsd: day.totalUsd,
    }

    for (const [model, amount] of Object.entries(day.byModel)) {
      row[model] = amount
    }

    return row
  })
}

type UsageCostChartProps = {
  initialYear?: number
  initialMonth?: number
}

export function UsageCostChart({
  initialYear,
  initialMonth,
}: UsageCostChartProps) {
  const [cursor, setCursor] = useState(() => {
    const current = currentMonthCursor()
    return {
      year: initialYear ?? current.year,
      month: initialMonth ?? current.month,
    }
  })
  const [modelFilter, setModelFilter] = useState("all")
  const [series, setSeries] = useState<UsageCostSeries | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadSeries() {
      setLoading(true)

      const params = new URLSearchParams({
        year: String(cursor.year),
        month: String(cursor.month),
      })

      try {
        const response = await fetch(`/api/usage/cost-series?${params}`)
        if (response.ok) {
          setSeries((await response.json()) as UsageCostSeries)
        }
      } finally {
        setLoading(false)
      }
    }

    void loadSeries()
  }, [cursor.month, cursor.year])

  useEffect(() => {
    if (
      modelFilter !== "all" &&
      series &&
      !series.models.some((model) => model.model === modelFilter)
    ) {
      setModelFilter("all")
    }
  }, [modelFilter, series])

  const availableModels = series?.models ?? []
  const chartModels =
    modelFilter === "all"
      ? availableModels
      : availableModels.filter((model) => model.model === modelFilter)
  const filteredSeries = useMemo(() => {
    if (!series || modelFilter === "all") {
      return series
    }

    const days = series.days.map((day) => {
      const amount = day.byModel[modelFilter] ?? 0
      return {
        date: day.date,
        totalUsd: amount,
        byModel: amount > 0 ? { [modelFilter]: amount } : {},
      }
    })

    const models = availableModels.filter((model) => model.model === modelFilter)

    return {
      ...series,
      days,
      models,
    }
  }, [availableModels, modelFilter, series])
  const chartConfig = useMemo(
    () => buildChartConfig(chartModels),
    [chartModels]
  )
  const chartData = useMemo(
    () => (filteredSeries ? buildChartData(filteredSeries) : []),
    [filteredSeries]
  )
  const monthTotalUsd = useMemo(
    () => chartModels.reduce((sum, model) => sum + model.totalUsd, 0),
    [chartModels]
  )
  const topModels = chartModels.slice(0, 3)
  const hasUsage = (series?.models.length ?? 0) > 0
  const currentMonth = currentMonthCursor()
  const canGoForward =
    cursor.year < currentMonth.year ||
    (cursor.year === currentMonth.year && cursor.month < currentMonth.month)

  const goToPreviousMonth = () => {
    setCursor((monthCursor) => {
      if (monthCursor.month === 1) {
        return { year: monthCursor.year - 1, month: 12 }
      }

      return { year: monthCursor.year, month: monthCursor.month - 1 }
    })
  }

  const goToNextMonth = () => {
    setCursor((monthCursor) => {
      const nextMonth = monthCursor.month === 12 ? 1 : monthCursor.month + 1
      const nextYear =
        monthCursor.month === 12 ? monthCursor.year + 1 : monthCursor.year

      if (isAfterCurrentMonth(nextYear, nextMonth)) {
        return monthCursor
      }

      return { year: nextYear, month: nextMonth }
    })
  }

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Cost</CardTitle>
          <p className="text-sm text-muted-foreground">
            Estimated usage cost by model
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="Previous month"
              onClick={goToPreviousMonth}
            >
              <ChevronLeft />
            </Button>
            <span className="min-w-32 text-center text-sm font-medium">
              {formatMonthLabel(cursor.year, cursor.month)}
            </span>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="Next month"
              disabled={!canGoForward}
              onClick={goToNextMonth}
            >
              <ChevronRight />
            </Button>
          </div>
          <Select
            value={modelFilter}
            onValueChange={(value) => setModelFilter(value ?? "all")}
          >
            <SelectTrigger className="w-[180px] bg-muted/50">
              <SelectValue placeholder="All models" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All models</SelectItem>
              {availableModels.map((model) => (
                <SelectItem key={model.model} value={model.model}>
                  {model.model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading ? (
          <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
            Loading usage...
          </div>
        ) : !hasUsage ? (
          <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
            No usage recorded this month.
          </div>
        ) : (
          <>
            <ChartContainer config={chartConfig} className="aspect-auto h-72 w-full">
              <BarChart data={chartData} margin={{ left: 4, right: 4, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  interval={2}
                  minTickGap={24}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tickFormatter={(value: number) =>
                    value >= 1 ? `$${value}` : `$${value.toFixed(2)}`
                  }
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) => {
                        const date = payload[0]?.payload?.date
                        return typeof date === "string"
                          ? formatDayLabel(date)
                          : ""
                      }}
                      formatter={(value, name) => (
                        <div className="flex w-full items-center justify-between gap-4">
                          <span className="text-muted-foreground">{name}</span>
                          <span className="font-mono font-medium">
                            {formatUsd(Number(value))}
                          </span>
                        </div>
                      )}
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
                {chartModels.map((model) => (
                  <Bar
                    key={model.model}
                    dataKey={model.model}
                    stackId="cost"
                    fill={`var(--color-${model.model})`}
                    radius={[0, 0, 0, 0]}
                  />
                ))}
              </BarChart>
            </ChartContainer>
            <div className="flex flex-wrap gap-4 border-t pt-4 text-sm">
              <div>
                <p className="text-muted-foreground">Month total</p>
                <p className="font-semibold">{formatUsd(monthTotalUsd)}</p>
              </div>
              {topModels.map((model) => (
                <div key={model.model}>
                  <p className="text-muted-foreground">{model.model}</p>
                  <p className="font-semibold">{formatUsd(model.totalUsd)}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
