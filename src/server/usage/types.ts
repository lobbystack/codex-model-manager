import type { ProviderId } from "@/proxy/model-registry"

export type UsageStatus = "success" | "error"

export type UsageTokens = {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  reasoningTokens: number
}

export type UsageLogEntry = UsageTokens & {
  id: string
  requestedAt: string
  provider: ProviderId
  model: string
  upstreamModel: string
  route: "chat" | "responses"
  status: UsageStatus
  statusCode: number
  errorCode: string | null
  errorMessage: string | null
  serviceTier: string | null
  estimatedCostUsd: number
  realCostUsd: number
  latencyMs: number
}

export type UsageSummary = {
  requests: number
  tokens: number
  estimatedCostUsd: number
  realCostUsd: number
  errorRate: number
  errors: number
  range: "today" | "7d" | "30d" | "all"
  byModel: Array<{
    provider: ProviderId
    model: string
    requests: number
    tokens: number
    estimatedCostUsd: number
    realCostUsd: number
    errors: number
  }>
}
