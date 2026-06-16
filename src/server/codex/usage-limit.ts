import { getAccountById } from "@/server/accounts/store"
import {
  getCachedUsageForAccount,
  refreshUsageForAccount,
  startUsageRefreshLoop,
} from "@/server/balancer/usage-cache"
import { getSelectedAccount } from "@/server/balancer"

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

let refreshStarted = false

function ensureUsageRefresh() {
  if (!refreshStarted) {
    refreshStarted = true
    startUsageRefreshLoop()
  }
}

export async function getChatGptUsageLimitForAccount(
  accountId: string
): Promise<UsageLimitSummary> {
  ensureUsageRefresh()
  return refreshUsageForAccount(accountId)
}

export async function getChatGptUsageLimit(
  accountId?: string | null
): Promise<UsageLimitSummary> {
  ensureUsageRefresh()

  if (accountId) {
    const account = await getAccountById(accountId)

    if (account) {
      return getChatGptUsageLimitForAccount(accountId)
    }
  }

  const selected = await getSelectedAccount()

  if (!selected) {
    return {
      planType: null,
      primaryWindow: null,
      secondaryWindow: null,
    }
  }

  return getCachedUsageForAccount(selected.id)
}
