import { getActiveAccount } from "@/server/accounts/store"
import { getActiveAccessToken } from "@/server/oauth/service"

type UsageWindowPayload = {
  used_percent?: unknown
  reset_at?: unknown
  limit_window_seconds?: unknown
  reset_after_seconds?: unknown
}

type UsagePayload = {
  plan_type?: unknown
  rate_limit?: {
    primary_window?: UsageWindowPayload | null
    secondary_window?: UsageWindowPayload | null
  } | null
}

export type UsageLimitWindow = {
  usedPercent: number | null
  remainingPercent: number | null
  resetAt: number | null
  limitWindowSeconds: number | null
  resetAfterSeconds: number | null
}

export type UsageLimitSummary = {
  planType: string | null
  primaryWindow: UsageLimitWindow | null
  secondaryWindow: UsageLimitWindow | null
}

const CACHE_TTL_MS = 60 * 1000

let cache: { expiresAt: number; summary: UsageLimitSummary } | undefined

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function usageWindow(payload: UsageWindowPayload | null | undefined) {
  if (!payload) {
    return null
  }

  const usedPercent = numberOrNull(payload.used_percent)

  return {
    usedPercent,
    remainingPercent:
      usedPercent === null ? null : Math.max(0, Math.min(100, 100 - usedPercent)),
    resetAt: numberOrNull(payload.reset_at),
    limitWindowSeconds: numberOrNull(payload.limit_window_seconds),
    resetAfterSeconds: numberOrNull(payload.reset_after_seconds),
  }
}

export async function getChatGptUsageLimit(): Promise<UsageLimitSummary> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.summary
  }

  const account = await getActiveAccount()
  const token = account ? await getActiveAccessToken() : null

  if (!account || !token) {
    return {
      planType: null,
      primaryWindow: null,
      secondaryWindow: null,
    }
  }

  const headers = new Headers({
    accept: "application/json",
    authorization: `Bearer ${token}`,
  })

  if (account.chatgptAccountId) {
    headers.set("chatgpt-account-id", account.chatgptAccountId)
  }

  const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
    headers,
  })

  if (!response.ok) {
    throw new Error(`Unable to load usage limit (${response.status}).`)
  }

  const payload = (await response.json()) as UsagePayload
  const summary = {
    planType: typeof payload.plan_type === "string" ? payload.plan_type : null,
    primaryWindow: usageWindow(payload.rate_limit?.primary_window),
    secondaryWindow: usageWindow(payload.rate_limit?.secondary_window),
  }

  cache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    summary,
  }

  return summary
}
