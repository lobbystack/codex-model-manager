
import {
  classifyUpstreamFailure,
  extractErrorCode,
  extractUpstreamError,
  failoverDecision,
} from "./classify"
import { selectAccount, syncRuntimeUsage } from "./logic"
import { getAccountRuntime, markAccountSelected } from "./runtime"
import {
  getCachedUsageForAccount,
  markAccountQuotaExceeded,
  markAccountRateLimited,
  startUsageRefreshLoop,
} from "./usage-cache"
import type { BalancerAccountState, SelectionResult } from "./types"
import type { StoredAccount } from "@/server/accounts/types"
import {
  getAccountById,
  listPoolAccounts,
  updateAccountStatus,
} from "@/server/accounts/store"

const MAX_SELECTION_ATTEMPTS = 4

let refreshStarted = false

function ensureUsageRefresh() {
  if (!refreshStarted) {
    refreshStarted = true
    startUsageRefreshLoop()
  }
}

async function buildBalancerStates(
  excludeAccountIds: Set<string> = new Set()
): Promise<Array<BalancerAccountState>> {
  const accounts = await listPoolAccounts()

  return Promise.all(
    accounts
      .filter((account) => !excludeAccountIds.has(account.id))
      .map(async (account) => {
        try {
          const summary = await getCachedUsageForAccount(account.id)
          syncRuntimeUsage(account.id, {
            primaryUsedPercent: summary.primaryWindow?.usedPercent ?? null,
            secondaryUsedPercent: summary.secondaryWindow?.usedPercent ?? null,
            primaryResetAt: summary.primaryWindow?.resetAt ?? null,
            secondaryResetAt: summary.secondaryWindow?.resetAt ?? null,
          })
        } catch {
          // Keep routing with stored runtime state when usage refresh fails.
        }

        return {
          account,
          status: account.status,
          runtime: getAccountRuntime(account.id),
        }
      })
  )
}

export async function selectAccountForRequest(
  excludeAccountIds: Set<string> = new Set()
): Promise<SelectionResult> {
  ensureUsageRefresh()
  const states = await buildBalancerStates(excludeAccountIds)
  const result = selectAccount(states, { excludeAccountIds })

  if (result.account) {
    markAccountSelected(result.account.id)
  }

  return result
}

export async function getSelectedAccount(): Promise<StoredAccount | null> {
  const result = await selectAccountForRequest()
  return result.account
}

export async function markFailureAndShouldRetry(input: {
  accountId: string
  payload: unknown
  httpStatus: number
  phase: "connect" | "first_event"
  candidatesRemaining: number
}) {
  const error = extractUpstreamError(input.payload)
  const errorCode = extractErrorCode(input.payload, input.httpStatus)
  const classified = classifyUpstreamFailure({
    errorCode,
    error,
    httpStatus: input.httpStatus,
    phase: input.phase,
  })

  if (classified.failureClass === "rate_limit") {
    await markAccountRateLimited(input.accountId, error)
  } else if (classified.failureClass === "quota") {
    await markAccountQuotaExceeded(input.accountId, error)
  }

  const action = failoverDecision({
    failureClass: classified.failureClass,
    downstreamVisible: false,
    candidatesRemaining: input.candidatesRemaining,
  })

  return {
    shouldRetry: action === "failover_next",
    classified,
  }
}

export { MAX_SELECTION_ATTEMPTS }

export async function getAccountByIdOrNull(accountId: string) {
  return getAccountById(accountId)
}

export async function pauseAccount(accountId: string) {
  return updateAccountStatus(accountId, "paused")
}

export async function resumeAccount(accountId: string) {
  return updateAccountStatus(accountId, "active")
}
