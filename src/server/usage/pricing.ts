import type { ProviderId } from "@/proxy/model-registry"
import type { UsageTokens } from "./types"

type ModelPrice = {
  inputPer1m: number
  outputPer1m: number
  cachedInputPer1m?: number
  priorityMultiplier?: number
  priorityInputPer1m?: number
  priorityOutputPer1m?: number
  priorityCachedInputPer1m?: number
  flexInputPer1m?: number
  flexOutputPer1m?: number
  flexCachedInputPer1m?: number
  longContextThresholdTokens?: number
  longContextInputPer1m?: number
  longContextOutputPer1m?: number
  longContextCachedInputPer1m?: number
}

type OpenRouterModel = {
  id?: string
  pricing?: {
    prompt?: string
    completion?: string
    input_cache_read?: string
  }
}

let openRouterPricesCache: {
  expiresAt: number
  prices: Map<string, ModelPrice>
} | null = null

const OPENROUTER_PRICE_FALLBACKS: Partial<Record<string, ModelPrice>> = {
  "moonshotai/kimi-k2.6": {
    inputPer1m: 0.73,
    cachedInputPer1m: 0.25,
    outputPer1m: 3.49,
  },
}

const DEFAULT_PRICING_MODELS: Partial<Record<string, ModelPrice>> = {
  "big-pickle": { inputPer1m: 0, cachedInputPer1m: 0, outputPer1m: 0 },
  "deepseek-v4-flash-free": {
    inputPer1m: 0,
    cachedInputPer1m: 0,
    outputPer1m: 0,
  },
  "minimax-m2.5-free": { inputPer1m: 0, cachedInputPer1m: 0, outputPer1m: 0 },
  "nemotron-3-super-free": {
    inputPer1m: 0,
    cachedInputPer1m: 0,
    outputPer1m: 0,
  },
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
  "claude-sonnet-4-6": {
    inputPer1m: 3,
    cachedInputPer1m: 0.3,
    outputPer1m: 15,
  },
  "claude-sonnet-4-5": {
    inputPer1m: 3,
    cachedInputPer1m: 0.3,
    outputPer1m: 15,
  },
  "claude-sonnet-4": { inputPer1m: 3, cachedInputPer1m: 0.3, outputPer1m: 15 },
  "claude-haiku-4-5": { inputPer1m: 1, cachedInputPer1m: 0.1, outputPer1m: 5 },
  "gemini-3.1-pro": { inputPer1m: 2, cachedInputPer1m: 0.2, outputPer1m: 12 },
  "gemini-3-flash": { inputPer1m: 0.5, cachedInputPer1m: 0.05, outputPer1m: 3 },
  "gpt-5.5": {
    inputPer1m: 5,
    cachedInputPer1m: 0.5,
    outputPer1m: 30,
    flexInputPer1m: 2.5,
    flexCachedInputPer1m: 0.25,
    flexOutputPer1m: 15,
    priorityInputPer1m: 12.5,
    priorityCachedInputPer1m: 1.25,
    priorityOutputPer1m: 75,
  },
  "gpt-5.5-pro": {
    inputPer1m: 30,
    outputPer1m: 180,
    flexInputPer1m: 15,
    flexOutputPer1m: 90,
  },
  "gpt-5.4": {
    inputPer1m: 2.5,
    cachedInputPer1m: 0.25,
    outputPer1m: 15,
    priorityInputPer1m: 5,
    priorityCachedInputPer1m: 0.5,
    priorityOutputPer1m: 30,
    flexInputPer1m: 1.25,
    flexCachedInputPer1m: 0.125,
    flexOutputPer1m: 7.5,
    longContextThresholdTokens: 272_000,
    longContextInputPer1m: 5,
    longContextCachedInputPer1m: 0.5,
    longContextOutputPer1m: 22.5,
  },
  "gpt-5.4-pro": {
    inputPer1m: 30,
    outputPer1m: 180,
    flexInputPer1m: 15,
    flexOutputPer1m: 90,
    longContextThresholdTokens: 272_000,
    longContextInputPer1m: 60,
    longContextOutputPer1m: 270,
  },
  "gpt-5.4-mini": {
    inputPer1m: 0.75,
    cachedInputPer1m: 0.075,
    outputPer1m: 4.5,
    flexInputPer1m: 0.375,
    flexCachedInputPer1m: 0.0375,
    flexOutputPer1m: 2.25,
  },
  "gpt-5.4-nano": {
    inputPer1m: 0.2,
    cachedInputPer1m: 0.02,
    outputPer1m: 1.25,
    flexInputPer1m: 0.1,
    flexCachedInputPer1m: 0.01,
    flexOutputPer1m: 0.625,
  },
  "gpt-5.3-codex-spark": {
    inputPer1m: 1.75,
    cachedInputPer1m: 0.175,
    outputPer1m: 14,
    priorityInputPer1m: 3.5,
    priorityCachedInputPer1m: 0.35,
    priorityOutputPer1m: 28,
  },
  "gpt-5.3-codex": {
    inputPer1m: 1.75,
    cachedInputPer1m: 0.175,
    outputPer1m: 14,
    priorityInputPer1m: 3.5,
    priorityCachedInputPer1m: 0.35,
    priorityOutputPer1m: 28,
  },
  "gpt-5.3": { inputPer1m: 1.75, cachedInputPer1m: 0.175, outputPer1m: 14 },
  "gpt-5.3-chat-latest": {
    inputPer1m: 1.75,
    cachedInputPer1m: 0.175,
    outputPer1m: 14,
  },
  "gpt-5.2": {
    inputPer1m: 1.75,
    cachedInputPer1m: 0.175,
    outputPer1m: 14,
    priorityMultiplier: 2,
    flexInputPer1m: 0.875,
    flexCachedInputPer1m: 0.0875,
    flexOutputPer1m: 7,
  },
  "gpt-5.2-chat-latest": {
    inputPer1m: 1.75,
    cachedInputPer1m: 0.175,
    outputPer1m: 14,
  },
  "gpt-5.2-codex": {
    inputPer1m: 1.75,
    cachedInputPer1m: 0.175,
    outputPer1m: 14,
    priorityInputPer1m: 3.5,
    priorityCachedInputPer1m: 0.35,
    priorityOutputPer1m: 28,
  },
  "gpt-5.1": {
    inputPer1m: 1.25,
    cachedInputPer1m: 0.125,
    outputPer1m: 10,
    priorityMultiplier: 2,
    flexInputPer1m: 0.625,
    flexCachedInputPer1m: 0.0625,
    flexOutputPer1m: 5,
  },
  "gpt-5.1-chat-latest": {
    inputPer1m: 1.25,
    cachedInputPer1m: 0.125,
    outputPer1m: 10,
  },
  "gpt-5.1-codex": {
    inputPer1m: 1.25,
    cachedInputPer1m: 0.125,
    outputPer1m: 10,
    priorityInputPer1m: 2.5,
    priorityCachedInputPer1m: 0.25,
    priorityOutputPer1m: 20,
  },
  "gpt-5.1-codex-max": {
    inputPer1m: 1.25,
    cachedInputPer1m: 0.125,
    outputPer1m: 10,
    priorityInputPer1m: 2.5,
    priorityCachedInputPer1m: 0.25,
    priorityOutputPer1m: 20,
  },
  "gpt-5.1-codex-mini": {
    inputPer1m: 0.25,
    cachedInputPer1m: 0.025,
    outputPer1m: 2,
  },
  "gpt-5": {
    inputPer1m: 1.25,
    cachedInputPer1m: 0.125,
    outputPer1m: 10,
    priorityMultiplier: 2,
    flexInputPer1m: 0.625,
    flexCachedInputPer1m: 0.0625,
    flexOutputPer1m: 5,
  },
  "gpt-5-chat-latest": {
    inputPer1m: 1.25,
    cachedInputPer1m: 0.125,
    outputPer1m: 10,
  },
  "gpt-5-codex": {
    inputPer1m: 1.25,
    cachedInputPer1m: 0.125,
    outputPer1m: 10,
    priorityInputPer1m: 2.5,
    priorityCachedInputPer1m: 0.25,
    priorityOutputPer1m: 20,
  },
  "gpt-5-nano": { inputPer1m: 0.05, cachedInputPer1m: 0.005, outputPer1m: 0.4 },
}

const DEFAULT_MODEL_ALIASES: Record<string, string> = {
  "gpt-5.5-pro*": "gpt-5.5-pro",
  "gpt-5.5*": "gpt-5.5",
  "gpt-5.4-pro*": "gpt-5.4-pro",
  "gpt-5.4-mini*": "gpt-5.4-mini",
  "gpt-5.4-nano*": "gpt-5.4-nano",
  "gpt-5.4*": "gpt-5.4",
  "gpt-5.3-codex-spark*": "gpt-5.3-codex-spark",
  "gpt-5.3-codex*": "gpt-5.3-codex",
  "gpt-5.3-chat-latest*": "gpt-5.3-chat-latest",
  "gpt-5.3*": "gpt-5.3",
  "gpt-5.2-codex*": "gpt-5.2-codex",
  "gpt-5.2-chat-latest*": "gpt-5.2-chat-latest",
  "gpt-5.2*": "gpt-5.2",
  "gpt-5.1-codex-max*": "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini*": "gpt-5.1-codex-mini",
  "gpt-5.1-codex*": "gpt-5.1-codex",
  "gpt-5.1-chat-latest*": "gpt-5.1-chat-latest",
  "gpt-5.1*": "gpt-5.1",
  "gpt-5-codex*": "gpt-5-codex",
  "gpt-5-chat-latest*": "gpt-5-chat-latest",
  "gpt-5*": "gpt-5",
}

function matchesPattern(value: string, pattern: string) {
  if (!pattern.endsWith("*")) {
    return value === pattern
  }

  return value.startsWith(pattern.slice(0, -1))
}

function normalizeModelId(model: string) {
  return model
    .replace(/^opencode\//, "")
    .replace(/^openrouter\//, "")
    .toLowerCase()
}

function resolveModelAlias(
  model: string,
  aliases: Record<string, string> = DEFAULT_MODEL_ALIASES
) {
  const normalized = normalizeModelId(model)
  let match: { length: number; target: string } | null = null

  for (const [pattern, target] of Object.entries(aliases)) {
    if (!matchesPattern(normalized, pattern.toLowerCase())) {
      continue
    }

    if (!match || pattern.length > match.length) {
      match = { length: pattern.length, target }
    }
  }

  return match?.target
}

function getPricingForModel(
  model: string,
  pricing: Partial<Record<string, ModelPrice>> = DEFAULT_PRICING_MODELS,
  aliases: Record<string, string> = DEFAULT_MODEL_ALIASES
) {
  const normalized = normalizeModelId(model)
  const exact = pricing[normalized]

  if (exact) {
    return exact
  }

  const alias = resolveModelAlias(normalized, aliases)
  return alias ? pricing[alias.toLowerCase()] : undefined
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

function normalizeServiceTier(serviceTier: string | null | undefined) {
  const normalized = serviceTier?.trim().toLowerCase()
  return normalized || null
}

function usesPriorityTier(serviceTier: string | null | undefined) {
  const normalized = normalizeServiceTier(serviceTier)
  return normalized === "priority" || normalized === "fast"
}

function usesFlexTier(serviceTier: string | null | undefined) {
  return normalizeServiceTier(serviceTier) === "flex"
}

function effectiveRates(
  tokens: UsageTokens,
  price: ModelPrice,
  serviceTier?: string | null
) {
  const isLongContext =
    price.longContextThresholdTokens !== undefined &&
    tokens.inputTokens > price.longContextThresholdTokens &&
    price.longContextInputPer1m !== undefined &&
    price.longContextOutputPer1m !== undefined
  let inputRate = price.inputPer1m
  let cachedRate = price.cachedInputPer1m ?? inputRate
  let outputRate = price.outputPer1m

  if (usesPriorityTier(serviceTier)) {
    if (
      price.priorityInputPer1m !== undefined &&
      price.priorityOutputPer1m !== undefined
    ) {
      return {
        inputRate: price.priorityInputPer1m,
        cachedRate: price.priorityCachedInputPer1m ?? price.priorityInputPer1m,
        outputRate: price.priorityOutputPer1m,
      }
    }

    if (price.priorityMultiplier !== undefined) {
      return {
        inputRate: inputRate * price.priorityMultiplier,
        cachedRate: cachedRate * price.priorityMultiplier,
        outputRate: outputRate * price.priorityMultiplier,
      }
    }
  }

  if (
    usesFlexTier(serviceTier) &&
    price.flexInputPer1m !== undefined &&
    price.flexOutputPer1m !== undefined
  ) {
    inputRate = price.flexInputPer1m
    cachedRate = price.flexCachedInputPer1m ?? inputRate
    outputRate = price.flexOutputPer1m

    if (isLongContext) {
      inputRate *= 2
      cachedRate *= 2
      outputRate *= 1.5
    }

    return { inputRate, cachedRate, outputRate }
  }

  if (isLongContext) {
    inputRate = price.longContextInputPer1m ?? inputRate
    cachedRate = price.longContextCachedInputPer1m ?? inputRate
    outputRate = price.longContextOutputPer1m ?? outputRate
  }

  return { inputRate, cachedRate, outputRate }
}

export function calculateTokenCost(
  tokens: UsageTokens,
  price: ModelPrice,
  serviceTier?: string | null
) {
  const cached = Math.min(tokens.cachedInputTokens, tokens.inputTokens)
  const billableInput = Math.max(0, tokens.inputTokens - cached)
  const outputTokens = tokens.outputTokens || tokens.reasoningTokens
  const { inputRate, cachedRate, outputRate } = effectiveRates(
    tokens,
    price,
    serviceTier
  )

  return (
    (billableInput / 1_000_000) * inputRate +
    (cached / 1_000_000) * cachedRate +
    (outputTokens / 1_000_000) * outputRate
  )
}

export function calculateRegistryCostUsd(
  model: string,
  tokens: UsageTokens,
  serviceTier?: string | null
) {
  const price = getPricingForModel(model)
  return price ? calculateTokenCost(tokens, price, serviceTier) : null
}

export async function calculateEstimatedCostUsd(
  provider: ProviderId,
  model: string,
  tokens: UsageTokens,
  upstreamCostUsd = 0,
  serviceTier?: string | null
) {
  if (provider === "openrouter") {
    if (upstreamCostUsd > 0) {
      return upstreamCostUsd
    }

    const price = await resolveOpenRouterPrice(model)
    return price ? calculateTokenCost(tokens, price, serviceTier) : 0
  }

  if (provider === "opencode-zen") {
    if (upstreamCostUsd > 0) {
      return upstreamCostUsd
    }

    return calculateRegistryCostUsd(model, tokens, serviceTier) ?? 0
  }

  if (provider === "ollama-cloud") {
    return 0
  }

  return calculateRegistryCostUsd(model, tokens, serviceTier) ?? 0
}

export function calculateRealCostUsd(
  provider: ProviderId,
  estimatedCostUsd: number
) {
  if (provider === "openrouter") {
    return estimatedCostUsd
  }

  if (provider === "opencode-zen") {
    return estimatedCostUsd
  }

  if (provider === "ollama-cloud") {
    return estimatedCostUsd
  }

  return 0
}
