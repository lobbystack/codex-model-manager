import { handleQuotaExceeded, handleRateLimit, syncRuntimeUsage } from "./logic"
import { getAccountRuntime } from "./runtime"
import type { UsageLimitSummary } from "@/server/codex/usage-limit"
import { deriveQuotaExceeded, parseWhamUsagePayload } from "@/server/codex/usage-parse"
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
  return parseWhamUsagePayload(payload)
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

  const runtime = getAccountRuntime(accountId)
  const now = Date.now() / 1000
  const primaryUsed = summary.primaryWindow?.usedPercent
  const primaryExhausted =
    primaryUsed !== null && primaryUsed !== undefined && primaryUsed >= 100

  if (deriveQuotaExceeded(summary)) {
    handleQuotaExceeded(accountId, {
      resets_at:
        summary.secondaryWindow?.resetAt ??
        summary.primaryWindow?.resetAt ??
        undefined,
    })
    await updateAccountStatus(accountId, "quota_exceeded")
    return
  }

  if (
    primaryExhausted &&
    summary.limitReached !== false &&
    !summary.hasCredits
  ) {
    handleRateLimit(accountId, {
      resets_at: summary.primaryWindow?.resetAt ?? undefined,
    })
    await updateAccountStatus(accountId, "rate_limited")
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
  invalidateUsageCache(accountId)
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
