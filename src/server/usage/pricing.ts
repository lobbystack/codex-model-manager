import type { ProviderId } from "@/proxy/model-registry"
import type { UsageTokens } from "./types"

type ModelPrice = {
  inputPer1m: number
  outputPer1m: number
  cachedInputPer1m?: number
}

type OpenRouterModel = {
  id?: string
  pricing?: {
    prompt?: string
    completion?: string
    input_cache_read?: string
  }
}

let openRouterPricesCache:
  | { expiresAt: number; prices: Map<string, ModelPrice> }
  | null = null

const OPENROUTER_PRICE_FALLBACKS: Partial<Record<string, ModelPrice>> = {
  "moonshotai/kimi-k2.6": {
    inputPer1m: 0.73,
    cachedInputPer1m: 0.25,
    outputPer1m: 3.49,
  },
}

const OPENCODE_ZEN_PRICES: Partial<Record<string, ModelPrice>> = {
  "big-pickle": { inputPer1m: 0, cachedInputPer1m: 0, outputPer1m: 0 },
  "deepseek-v4-flash-free": { inputPer1m: 0, cachedInputPer1m: 0, outputPer1m: 0 },
  "minimax-m2.5-free": { inputPer1m: 0, cachedInputPer1m: 0, outputPer1m: 0 },
  "nemotron-3-super-free": { inputPer1m: 0, cachedInputPer1m: 0, outputPer1m: 0 },
  "qwen3.6-plus-free": { inputPer1m: 0, cachedInputPer1m: 0, outputPer1m: 0 },
  "minimax-m2.7": { inputPer1m: 0.3, cachedInputPer1m: 0.06, outputPer1m: 1.2 },
  "minimax-m2.5": { inputPer1m: 0.3, cachedInputPer1m: 0.06, outputPer1m: 1.2 },
  "glm-5.1": { inputPer1m: 1.4, cachedInputPer1m: 0.26, outputPer1m: 4.4 },
  "glm-5": { inputPer1m: 1, cachedInputPer1m: 0.2, outputPer1m: 3.2 },
  "kimi-k2.5": { inputPer1m: 0.6, cachedInputPer1m: 0.1, outputPer1m: 3 },
  "kimi-k2.6": { inputPer1m: 0.95, cachedInputPer1m: 0.16, outputPer1m: 4 },
  "qwen3.6-plus": { inputPer1m: 0.5, cachedInputPer1m: 0.05, outputPer1m: 3 },
  "qwen3.5-plus": { inputPer1m: 0.2, cachedInputPer1m: 0.02, outputPer1m: 1.2 },
  "claude-opus-4-7": { inputPer1m: 5, cachedInputPer1m: 0.5, outputPer1m: 25 },
  "claude-opus-4-6": { inputPer1m: 5, cachedInputPer1m: 0.5, outputPer1m: 25 },
  "claude-opus-4-5": { inputPer1m: 5, cachedInputPer1m: 0.5, outputPer1m: 25 },
  "claude-opus-4-1": { inputPer1m: 15, cachedInputPer1m: 1.5, outputPer1m: 75 },
  "claude-sonnet-4-6": { inputPer1m: 3, cachedInputPer1m: 0.3, outputPer1m: 15 },
  "claude-sonnet-4-5": { inputPer1m: 3, cachedInputPer1m: 0.3, outputPer1m: 15 },
  "claude-sonnet-4": { inputPer1m: 3, cachedInputPer1m: 0.3, outputPer1m: 15 },
  "claude-haiku-4-5": { inputPer1m: 1, cachedInputPer1m: 0.1, outputPer1m: 5 },
  "gemini-3.1-pro": { inputPer1m: 2, cachedInputPer1m: 0.2, outputPer1m: 12 },
  "gemini-3-flash": { inputPer1m: 0.5, cachedInputPer1m: 0.05, outputPer1m: 3 },
  "gpt-5.5": { inputPer1m: 5, cachedInputPer1m: 0.5, outputPer1m: 30 },
  "gpt-5.5-pro": { inputPer1m: 30, cachedInputPer1m: 30, outputPer1m: 180 },
  "gpt-5.4": { inputPer1m: 2.5, cachedInputPer1m: 0.25, outputPer1m: 15 },
  "gpt-5.4-pro": { inputPer1m: 30, cachedInputPer1m: 30, outputPer1m: 180 },
  "gpt-5.4-mini": { inputPer1m: 0.75, cachedInputPer1m: 0.075, outputPer1m: 4.5 },
  "gpt-5.4-nano": { inputPer1m: 0.2, cachedInputPer1m: 0.02, outputPer1m: 1.25 },
  "gpt-5.3-codex-spark": { inputPer1m: 1.75, cachedInputPer1m: 0.175, outputPer1m: 14 },
  "gpt-5.3-codex": { inputPer1m: 1.75, cachedInputPer1m: 0.175, outputPer1m: 14 },
  "gpt-5.2": { inputPer1m: 1.75, cachedInputPer1m: 0.175, outputPer1m: 14 },
  "gpt-5.2-codex": { inputPer1m: 1.75, cachedInputPer1m: 0.175, outputPer1m: 14 },
  "gpt-5.1": { inputPer1m: 1.07, cachedInputPer1m: 0.107, outputPer1m: 8.5 },
  "gpt-5.1-codex": { inputPer1m: 1.07, cachedInputPer1m: 0.107, outputPer1m: 8.5 },
  "gpt-5.1-codex-max": { inputPer1m: 1.25, cachedInputPer1m: 0.125, outputPer1m: 10 },
  "gpt-5.1-codex-mini": { inputPer1m: 0.25, cachedInputPer1m: 0.025, outputPer1m: 2 },
  "gpt-5": { inputPer1m: 1.07, cachedInputPer1m: 0.107, outputPer1m: 8.5 },
  "gpt-5-codex": { inputPer1m: 1.07, cachedInputPer1m: 0.107, outputPer1m: 8.5 },
  "gpt-5-nano": { inputPer1m: 0.05, cachedInputPer1m: 0.005, outputPer1m: 0.4 },
}

const CHATGPT_PRICES: Partial<Record<string, ModelPrice>> = {
  "gpt-5.3-codex": {
    inputPer1m: 1.75,
    cachedInputPer1m: 0.175,
    outputPer1m: 14,
  },
  "gpt-5.3-codex-spark": {
    inputPer1m: 1.75,
    cachedInputPer1m: 0.175,
    outputPer1m: 14,
  },
  "gpt-5.2-codex": {
    inputPer1m: 1.75,
    cachedInputPer1m: 0.175,
    outputPer1m: 14,
  },
  "gpt-5.2": {
    inputPer1m: 1.75,
    cachedInputPer1m: 0.175,
    outputPer1m: 14,
  },
  "gpt-5.1-codex": {
    inputPer1m: 1.25,
    cachedInputPer1m: 0.125,
    outputPer1m: 10,
  },
  "gpt-5.1-codex-mini": {
    inputPer1m: 0.25,
    cachedInputPer1m: 0.025,
    outputPer1m: 2,
  },
  "gpt-5-codex": {
    inputPer1m: 1.25,
    cachedInputPer1m: 0.125,
    outputPer1m: 10,
  },
  "gpt-5.4-mini": {
    inputPer1m: 0.25,
    cachedInputPer1m: 0.025,
    outputPer1m: 2,
  },
}

const CHATGPT_ALIASES: Record<string, string> = {
  "gpt-5.3-codex-spark*": "gpt-5.3-codex-spark",
  "gpt-5.3-codex*": "gpt-5.3-codex",
  "gpt-5.2-codex*": "gpt-5.2-codex",
  "gpt-5.1-codex-mini*": "gpt-5.1-codex-mini",
  "gpt-5.1-codex*": "gpt-5.1-codex",
  "gpt-5-codex*": "gpt-5-codex",
}

function matchesPattern(value: string, pattern: string) {
  if (!pattern.endsWith("*")) {
    return value === pattern
  }

  return value.startsWith(pattern.slice(0, -1))
}

function resolveChatGptPrice(model: string) {
  const normalized = model.toLowerCase()

  if (CHATGPT_PRICES[normalized]) {
    return CHATGPT_PRICES[normalized]
  }

  const alias = Object.entries(CHATGPT_ALIASES)
    .sort(([a], [b]) => b.length - a.length)
    .find(([pattern]) => matchesPattern(normalized, pattern))?.[1]

  return alias ? CHATGPT_PRICES[alias] : undefined
}

function pricePer1m(value: string | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1_000_000 : null
}

async function getOpenRouterPrices() {
  if (openRouterPricesCache && openRouterPricesCache.expiresAt > Date.now()) {
    return openRouterPricesCache.prices
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { accept: "application/json" },
    })

    if (!response.ok) {
      throw new Error(`OpenRouter models request failed: ${response.status}`)
    }

    const data = (await response.json()) as { data?: Array<OpenRouterModel> }
    const prices = new Map<string, ModelPrice>()

    for (const model of data.data || []) {
      if (!model.id) {
        continue
      }

      const inputPer1m = pricePer1m(model.pricing?.prompt)
      const outputPer1m = pricePer1m(model.pricing?.completion)
      const cachedInputPer1m = pricePer1m(model.pricing?.input_cache_read)

      if (inputPer1m === null || outputPer1m === null) {
        continue
      }

      prices.set(model.id.toLowerCase(), {
        inputPer1m,
        outputPer1m,
        ...(cachedInputPer1m === null ? {} : { cachedInputPer1m }),
      })
    }

    openRouterPricesCache = {
      expiresAt: Date.now() + 5 * 60 * 1000,
      prices,
    }

    return prices
  } catch {
    return new Map<string, ModelPrice>()
  }
}

async function resolveOpenRouterPrice(model: string) {
  const normalized = model.toLowerCase()
  const livePrice = (await getOpenRouterPrices()).get(normalized)

  return livePrice || OPENROUTER_PRICE_FALLBACKS[normalized]
}

function resolveOpenCodeZenPrice(model: string) {
  return OPENCODE_ZEN_PRICES[model.replace(/^opencode\//, "").toLowerCase()]
}

export function calculateTokenCost(tokens: UsageTokens, price: ModelPrice) {
  const cached = Math.min(tokens.cachedInputTokens, tokens.inputTokens)
  const billableInput = Math.max(0, tokens.inputTokens - cached)
  const outputTokens = tokens.outputTokens || tokens.reasoningTokens
  const cachedRate = price.cachedInputPer1m ?? price.inputPer1m

  return (
    (billableInput / 1_000_000) * price.inputPer1m +
    (cached / 1_000_000) * cachedRate +
    (outputTokens / 1_000_000) * price.outputPer1m
  )
}

export async function calculateEstimatedCostUsd(
  provider: ProviderId,
  model: string,
  tokens: UsageTokens,
  upstreamCostUsd = 0
) {
  if (provider === "openrouter") {
    if (upstreamCostUsd > 0) {
      return upstreamCostUsd
    }

    const price = await resolveOpenRouterPrice(model)
    return price ? calculateTokenCost(tokens, price) : 0
  }

  if (provider === "opencode-zen") {
    if (upstreamCostUsd > 0) {
      return upstreamCostUsd
    }

    const price = resolveOpenCodeZenPrice(model)
    return price ? calculateTokenCost(tokens, price) : 0
  }

  const price = resolveChatGptPrice(model)
  return price ? calculateTokenCost(tokens, price) : 0
}

export function calculateRealCostUsd(provider: ProviderId, estimatedCostUsd: number) {
  if (provider === "openrouter") {
    return estimatedCostUsd
  }

  if (provider === "opencode-zen") {
    return estimatedCostUsd
  }

  return 0
}
