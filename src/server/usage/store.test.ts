import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { addUsageLog, getUsageCostSeries, getUsageSummary } from "./store"
import type { UsageLogEntry } from "./types"

let dataDir: string

const baseLog: UsageLogEntry = {
  id: "usage-log",
  requestedAt: new Date().toISOString(),
  provider: "openai-pool",
  model: "gpt-5.5",
  upstreamModel: "gpt-5.5",
  route: "responses",
  status: "success",
  statusCode: 200,
  errorCode: null,
  errorMessage: null,
  serviceTier: null,
  estimatedCostUsd: 0,
  realCostUsd: 0,
  latencyMs: 100,
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cachedInputTokens: 0,
  reasoningTokens: 0,
}

describe("getUsageSummary", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "cmm-usage-"))
    process.env.CMM_DATA_DIR = dataDir
  })

  afterEach(async () => {
    delete process.env.CMM_DATA_DIR
    await rm(dataDir, { force: true, recursive: true })
  })

  it("reprices persisted ChatGPT pool logs with the current registry", async () => {
    await addUsageLog(baseLog)

    const summary = await getUsageSummary("today")

    expect(summary.estimatedCostUsd).toBe(35)
    expect(summary.byModel[0].estimatedCostUsd).toBe(35)
  })
})

function logAt(iso: string, overrides: Partial<UsageLogEntry> = {}): UsageLogEntry {
  return {
    ...baseLog,
    id: crypto.randomUUID(),
    requestedAt: iso,
    ...overrides,
  }
}

function localIso(year: number, month: number, day: number, hour = 12) {
  return new Date(year, month - 1, day, hour).toISOString()
}

describe("getUsageCostSeries", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "cmm-usage-"))
    process.env.CMM_DATA_DIR = dataDir
  })

  afterEach(async () => {
    delete process.env.CMM_DATA_DIR
    await rm(dataDir, { force: true, recursive: true })
  })

  it("buckets estimated cost by local day and model", async () => {
    await addUsageLog(
      logAt(localIso(2026, 6, 10), {
        model: "gpt-5.5",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      })
    )
    await addUsageLog(
      logAt(localIso(2026, 6, 11), {
        model: "kimi-k2.6",
        provider: "opencode-zen",
        upstreamModel: "kimi-k2.6",
        inputTokens: 100_000,
        outputTokens: 50_000,
      })
    )
    await addUsageLog(
      logAt(localIso(2026, 7, 1), {
        model: "gpt-5.5",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      })
    )

    const series = await getUsageCostSeries({ year: 2026, month: 6 })

    expect(series.days).toHaveLength(30)
    expect(series.models.map((model) => model.model)).toEqual([
      "gpt-5.5",
      "kimi-k2.6",
    ])

    const day10 = series.days.find((day) => day.date === "2026-06-10")
    const day11 = series.days.find((day) => day.date === "2026-06-11")
    const day12 = series.days.find((day) => day.date === "2026-06-12")

    expect(day10?.totalUsd).toBe(35)
    expect(day10?.byModel["gpt-5.5"]).toBe(35)
    expect(day11?.totalUsd).toBeGreaterThan(0)
    expect(day12?.totalUsd).toBe(0)
  })

  it("filters to selected models", async () => {
    await addUsageLog(
      logAt(localIso(2026, 6, 16, 12), {
        model: "gpt-5.5",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      })
    )
    await addUsageLog(
      logAt(localIso(2026, 6, 16, 13), {
        model: "kimi-k2.6",
        provider: "opencode-zen",
        upstreamModel: "kimi-k2.6",
        inputTokens: 100_000,
        outputTokens: 50_000,
      })
    )

    const series = await getUsageCostSeries({
      year: 2026,
      month: 6,
      models: ["gpt-5.5"],
    })

    expect(series.models).toHaveLength(1)
    expect(series.models[0].model).toBe("gpt-5.5")
    expect(series.models[0].totalUsd).toBe(35)
  })
})
