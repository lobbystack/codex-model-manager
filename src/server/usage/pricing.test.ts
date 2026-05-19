import { describe, expect, it } from "vitest"

import { calculateEstimatedCostUsd } from "./pricing"
import type { UsageTokens } from "./types"

const emptyTokens: UsageTokens = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
}

describe("calculateEstimatedCostUsd", () => {
  it("prices GPT-5.5 usage routed through the ChatGPT pool", async () => {
    await expect(
      calculateEstimatedCostUsd("openai-pool", "gpt-5.5", {
        ...emptyTokens,
        inputTokens: 45_000_000,
        outputTokens: 100_000,
        cachedInputTokens: 40_000_000,
      })
    ).resolves.toBe(48)
  })

  it("prices GPT-5.5 date-suffixed aliases routed through the ChatGPT pool", async () => {
    await expect(
      calculateEstimatedCostUsd("openai-pool", "gpt-5.5-2026-05-18", {
        ...emptyTokens,
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      })
    ).resolves.toBe(35)
  })

  it("uses service-tier specific GPT-5.5 rates", async () => {
    const tokens = {
      ...emptyTokens,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    }

    await expect(
      calculateEstimatedCostUsd("openai-pool", "gpt-5.5", tokens, 0, "flex")
    ).resolves.toBe(17.5)
    await expect(
      calculateEstimatedCostUsd("openai-pool", "gpt-5.5", tokens, 0, "priority")
    ).resolves.toBe(87.5)
  })

  it("uses the longest model alias match", async () => {
    await expect(
      calculateEstimatedCostUsd("openai-pool", "gpt-5.1-codex-mini-2026", {
        ...emptyTokens,
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      })
    ).resolves.toBe(2.25)
  })

  it("uses long-context GPT-5.4 pricing", async () => {
    await expect(
      calculateEstimatedCostUsd("openai-pool", "gpt-5.4", {
        ...emptyTokens,
        inputTokens: 300_000,
        outputTokens: 100_000,
        cachedInputTokens: 50_000,
      })
    ).resolves.toBe(3.525)
  })
})
