import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { addUsageLog, getUsageSummary } from "./store"
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
