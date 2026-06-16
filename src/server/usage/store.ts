import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { calculateRegistryCostUsd } from "./pricing"
import type {
  UsageCostSeries,
  UsageLogEntry,
  UsageSummary,
} from "./types"

type StoreFile = {
  requestLogs: Array<UsageLogEntry>
}

let writeQueue = Promise.resolve()

function dataDir() {
  return process.env.CMM_DATA_DIR || join(homedir(), ".codex-model-manager")
}

function usagePath() {
  return join(dataDir(), "usage.json")
}

async function readStore(): Promise<StoreFile> {
  try {
    const raw = await readFile(usagePath(), "utf8")
    const parsed = JSON.parse(raw) as Partial<StoreFile>
    return {
      requestLogs: Array.isArray(parsed.requestLogs) ? parsed.requestLogs : [],
    }
  } catch {
    return { requestLogs: [] }
  }
}

async function writeStore(store: StoreFile) {
  const path = usagePath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 })
}

function startForRange(range: UsageSummary["range"]) {
  const now = new Date()

  if (range === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }

  if (range === "7d") {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  }

  if (range === "30d") {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  }

  return null
}

function roundCost(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000
}

function subscriptionAmountUsd() {
  const value = Number(process.env.CMM_CHATGPT_SUBSCRIPTION_USD || "0")
  return Number.isFinite(value) && value > 0 ? value : 0
}

function subscriptionRenewalDay() {
  const value = Number(process.env.CMM_CHATGPT_SUBSCRIPTION_RENEWAL_DAY || "0")
  return Number.isInteger(value) && value >= 1 && value <= 31 ? value : null
}

function subscriptionRenewalDate() {
  const value = process.env.CMM_CHATGPT_SUBSCRIPTION_RENEWS_AT

  if (!value) {
    return null
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function isSameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function subscriptionChargeForRange(
  range: UsageSummary["range"],
  start: Date | null
) {
  const amount = subscriptionAmountUsd()

  if (amount === 0) {
    return 0
  }

  const now = new Date()
  const configuredDate = subscriptionRenewalDate()

  if (configuredDate) {
    if (range === "today") {
      return isSameLocalDay(configuredDate, now) ? amount : 0
    }

    return (!start || configuredDate >= start) && configuredDate <= now
      ? amount
      : 0
  }

  const renewalDay = subscriptionRenewalDay()

  if (!renewalDay) {
    return 0
  }

  if (range === "today") {
    return now.getDate() === renewalDay ? amount : 0
  }

  if (!start) {
    return amount
  }

  for (
    let cursor = new Date(start);
    cursor <= now;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    if (cursor.getDate() === renewalDay) {
      return amount
    }
  }

  return 0
}

export async function addUsageLog(entry: UsageLogEntry) {
  writeQueue = writeQueue.then(async () => {
    const store = await readStore()
    store.requestLogs.push(entry)
    await writeStore(store)
  })

  await writeQueue
}

function estimatedCostForSummary(log: UsageLogEntry) {
  if (
    log.provider !== "openai-pool" &&
    log.provider !== "opencode-zen" &&
    log.provider !== "opencode-go"
  ) {
    return log.estimatedCostUsd
  }

  return (
    calculateRegistryCostUsd(
      log.upstreamModel || log.model,
      log,
      log.serviceTier
    ) ?? log.estimatedCostUsd
  )
}

export async function getUsageLogs(
  range: UsageSummary["range"] = "today",
  limit = 25,
  offset = 0
): Promise<{ logs: Array<UsageLogEntry>; total: number }> {
  const store = await readStore()
  const start = startForRange(range)
  const logs = start
    ? store.requestLogs.filter((log) => new Date(log.requestedAt) >= start)
    : store.requestLogs

  const sortedLogs = [...logs].sort(
    (a, b) =>
      new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
  )

  return {
    logs: sortedLogs.slice(offset, offset + limit),
    total: sortedLogs.length,
  }
}

export async function getUsageSummary(
  range: UsageSummary["range"] = "today"
): Promise<UsageSummary> {
  const store = await readStore()
  const start = startForRange(range)
  const logs = start
    ? store.requestLogs.filter((log) => new Date(log.requestedAt) >= start)
    : store.requestLogs
  const byModel = new Map<string, UsageSummary["byModel"][number]>()
  let tokens = 0
  let estimatedCostUsd = 0
  let realCostUsd = 0
  let errors = 0

  for (const log of logs) {
    const logTokens = log.inputTokens + log.outputTokens
    const logEstimatedCostUsd = estimatedCostForSummary(log)
    const key = `${log.provider}:${log.model}`
    const current = byModel.get(key) || {
      provider: log.provider,
      model: log.model,
      requests: 0,
      tokens: 0,
      estimatedCostUsd: 0,
      realCostUsd: 0,
      errors: 0,
    }

    tokens += logTokens
    estimatedCostUsd += logEstimatedCostUsd
    realCostUsd += log.realCostUsd
    errors += log.status === "error" ? 1 : 0

    current.requests += 1
    current.tokens += logTokens
    current.estimatedCostUsd += logEstimatedCostUsd
    current.realCostUsd += log.realCostUsd
    current.errors += log.status === "error" ? 1 : 0
    byModel.set(key, current)
  }

  const subscriptionChargeUsd = subscriptionChargeForRange(range, start)

  return {
    requests: logs.length,
    tokens,
    estimatedCostUsd: roundCost(estimatedCostUsd),
    realCostUsd: roundCost(realCostUsd + subscriptionChargeUsd),
    errorRate: logs.length > 0 ? errors / logs.length : 0,
    errors,
    range,
    byModel: [...byModel.values()]
      .map((model) => ({
        ...model,
        estimatedCostUsd: roundCost(model.estimatedCostUsd),
        realCostUsd: roundCost(model.realCostUsd),
      }))
      .sort((a, b) => b.requests - a.requests),
  }
}

function localDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function isInCalendarMonth(date: Date, year: number, month: number) {
  return date.getFullYear() === year && date.getMonth() + 1 === month
}

export async function getUsageCostSeries(options: {
  year: number
  month: number
  models?: Array<string>
  costKind?: "estimated"
}): Promise<UsageCostSeries> {
  const { year, month, models } = options
  const costKind = options.costKind ?? "estimated"
  const modelFilter =
    models && models.length > 0 ? new Set(models) : null
  const store = await readStore()
  const dayCount = daysInMonth(year, month)
  const byDate = new Map<string, Map<string, number>>()
  const modelTotals = new Map<
    string,
    { model: string; provider: UsageLogEntry["provider"]; totalUsd: number }
  >()

  for (const log of store.requestLogs) {
    if (modelFilter && !modelFilter.has(log.model)) {
      continue
    }

    const requestedAt = new Date(log.requestedAt)

    if (Number.isNaN(requestedAt.getTime())) {
      continue
    }

    if (!isInCalendarMonth(requestedAt, year, month)) {
      continue
    }

    const costUsd = estimatedCostForSummary(log)
    const dateKey = localDateKey(requestedAt)
    const dayModels = byDate.get(dateKey) || new Map<string, number>()
    dayModels.set(log.model, (dayModels.get(log.model) || 0) + costUsd)
    byDate.set(dateKey, dayModels)

    const modelEntry = modelTotals.get(log.model) || {
      model: log.model,
      provider: log.provider,
      totalUsd: 0,
    }
    modelEntry.totalUsd += costUsd
    modelTotals.set(log.model, modelEntry)
  }

  const days = Array.from({ length: dayCount }, (_, index) => {
    const day = index + 1
    const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    const dayModels = byDate.get(dateKey)
    const byModel: Record<string, number> = {}

    if (dayModels) {
      for (const [model, amount] of dayModels) {
        byModel[model] = roundCost(amount)
      }
    }

    const totalUsd = roundCost(
      Object.values(byModel).reduce((sum, value) => sum + value, 0)
    )

    return { date: dateKey, totalUsd, byModel }
  })

  const modelsList = [...modelTotals.values()]
    .map((entry) => ({
      ...entry,
      totalUsd: roundCost(entry.totalUsd),
    }))
    .filter((entry) => entry.totalUsd > 0)
    .sort((a, b) => b.totalUsd - a.totalUsd)

  return {
    year,
    month,
    costKind,
    days,
    models: modelsList,
  }
}
