import { handleQuotaExceeded, handleRateLimit, syncRuntimeUsage } from "./logic"
import { getAccountRuntime } from "./runtime"
import type { UsageLimitSummary } from "@/server/codex/usage-limit"
import {
  getAccountById,
  listPoolAccounts,
  updateAccountStatus,
} from "@/server/accounts/store"
import { getAccessTokenForAccount } from "@/server/oauth/service"


const CACHE_TTL_MS = 60 * 1000

type UsageCacheEntry = {
  expiresAt: number
  summary: UsageLimitSummary
}

const usageCache = new Map<string, UsageCacheEntry>()

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function usageWindow(payload: Record<string, unknown> | null | undefined) {
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

async function fetchUsageForAccount(accountId: string): Promise<UsageLimitSummary> {
  const account = await getAccountById(accountId)

  if (!account) {
    return {
      planType: null,
      primaryWindow: null,
      secondaryWindow: null,
    }
  }

  const token = await getAccessTokenForAccount(account)

  if (!token) {
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

  const payload = (await response.json()) as Record<string, unknown>
  const rateLimit =
    payload.rate_limit && typeof payload.rate_limit === "object"
      ? (payload.rate_limit as Record<string, unknown>)
      : null

  return {
    planType: typeof payload.plan_type === "string" ? payload.plan_type : null,
    primaryWindow: usageWindow(
      rateLimit?.primary_window as Record<string, unknown> | null | undefined
    ),
    secondaryWindow: usageWindow(
      rateLimit?.secondary_window as Record<string, unknown> | null | undefined
    ),
  }
}

export async function getCachedUsageForAccount(
  accountId: string
): Promise<UsageLimitSummary> {
  const cached = usageCache.get(accountId)

  if (cached && cached.expiresAt > Date.now()) {
    return cached.summary
  }

  const summary = await fetchUsageForAccount(accountId)
  usageCache.set(accountId, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    summary,
  })

  return summary
}

export function invalidateUsageCache(accountId?: string) {
  if (accountId) {
    usageCache.delete(accountId)
    return
  }

  usageCache.clear()
}

async function applyUsageStatus(accountId: string, summary: UsageLimitSummary) {
  syncRuntimeUsage(accountId, {
    primaryUsedPercent: summary.primaryWindow?.usedPercent ?? null,
    secondaryUsedPercent: summary.secondaryWindow?.usedPercent ?? null,
    primaryResetAt: summary.primaryWindow?.resetAt ?? null,
    secondaryResetAt: summary.secondaryWindow?.resetAt ?? null,
  })

  const primaryUsed = summary.primaryWindow?.usedPercent
  const secondaryUsed = summary.secondaryWindow?.usedPercent
  const runtime = getAccountRuntime(accountId)
  const now = Date.now() / 1000

  if (
    (primaryUsed !== null &&
      primaryUsed !== undefined &&
      primaryUsed >= 100) ||
    (secondaryUsed !== null &&
      secondaryUsed !== undefined &&
      secondaryUsed >= 100)
  ) {
    handleQuotaExceeded(accountId, {
      resets_at: summary.secondaryWindow?.resetAt ?? summary.primaryWindow?.resetAt ?? undefined,
    })
    await updateAccountStatus(accountId, "quota_exceeded")
    return
  }

  const account = await getAccountById(accountId)

  if (
    account &&
    (account.status === "quota_exceeded" || account.status === "rate_limited") &&
    (!runtime.cooldownUntil || runtime.cooldownUntil <= now)
  ) {
    await updateAccountStatus(accountId, "active")
  }
}

export async function refreshUsageForAccount(accountId: string) {
  const summary = await getCachedUsageForAccount(accountId)
  await applyUsageStatus(accountId, summary)
  return summary
}

let refreshTimer: ReturnType<typeof setInterval> | null = null

export function startUsageRefreshLoop() {
  if (refreshTimer) {
    return
  }

  const refreshAll = async () => {
    const accounts = await listPoolAccounts()

    await Promise.allSettled(
      accounts.map((account) => refreshUsageForAccount(account.id))
    )
  }

  void refreshAll()
  refreshTimer = setInterval(() => {
    void refreshAll()
  }, CACHE_TTL_MS)
}

export async function markAccountRateLimited(
  accountId: string,
  error: { message?: string; resets_at?: number; resets_in_seconds?: number }
) {
  handleRateLimit(accountId, error)
  await updateAccountStatus(accountId, "rate_limited")
  invalidateUsageCache(accountId)
}

export async function markAccountQuotaExceeded(
  accountId: string,
  error: { message?: string; resets_at?: number; resets_in_seconds?: number }
) {
  handleQuotaExceeded(accountId, error)
  await updateAccountStatus(accountId, "quota_exceeded")
  invalidateUsageCache(accountId)
}
