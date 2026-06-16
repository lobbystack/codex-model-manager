import { getAccountRuntime, updateAccountRuntime } from "./runtime"
import type { AccountStatus } from "@/server/accounts/types"

import type {
  AccountRuntimeState,
  BalancerAccountState,
  SelectionResult,
  UpstreamError,
} from "./types"

const QUOTA_EXCEEDED_COOLDOWN_SECONDS = 120
const SELECTOR_RETRY_HINT_MAX_SECONDS = 300

const RECOVERABLE_STATUSES = new Set<AccountStatus>([
  "active",
  "rate_limited",
  "quota_exceeded",
])

function backoffSeconds(errorCount: number) {
  if (errorCount <= 1) {
    return 30
  }

  if (errorCount === 2) {
    return 60
  }

  return Math.min(300, 30 * 2 ** (errorCount - 3))
}

function parseRetryAfter(message: string | undefined) {
  if (!message) {
    return null
  }

  const retryAfterMatch = message.match(/try again(?: at| in)?\s+([^.]+)/i)

  if (!retryAfterMatch) {
    const secondsMatch = message.match(/(\d+)\s*s(?:econds?)?/i)

    if (secondsMatch) {
      return Number(secondsMatch[1])
    }

    return null
  }

  const parsed = Date.parse(retryAfterMatch[1])

  if (!Number.isNaN(parsed)) {
    return Math.max(0, Math.ceil((parsed - Date.now()) / 1000))
  }

  return null
}

function extractResetAt(error: UpstreamError) {
  if (error.resets_at !== undefined) {
    return Math.floor(error.resets_at)
  }

  if (error.resets_in_seconds !== undefined) {
    return Math.floor(Date.now() / 1000 + error.resets_in_seconds)
  }

  return null
}

function formatRetryHint(waitSeconds: number) {
  const capped = Math.min(
    Math.max(0, waitSeconds),
    SELECTOR_RETRY_HINT_MAX_SECONDS
  )
  return `Rate limit exceeded. Try again in ${capped.toFixed(0)}s`
}

function usageSortKey(state: BalancerAccountState): [number, number, number, string] {
  const primaryUsed = state.runtime.usedPercent ?? 100
  const secondaryUsed = state.runtime.secondaryUsedPercent ?? primaryUsed
  const lastSelected = state.runtime.lastSelectedAt ?? 0

  return [secondaryUsed, primaryUsed, lastSelected, state.account.id]
}

function isUsageExhausted(state: BalancerAccountState) {
  const primaryUsed = state.runtime.usedPercent
  const secondaryUsed = state.runtime.secondaryUsedPercent

  return (
    (primaryUsed !== null && primaryUsed >= 100) ||
    (secondaryUsed !== null && secondaryUsed >= 100)
  )
}

function applyAvailabilityFilters(
  states: Array<BalancerAccountState>,
  current: number,
  excludeAccountIds: Set<string>
) {
  const available: Array<BalancerAccountState> = []
  const inErrorBackoff: Array<BalancerAccountState> = []

  for (const state of states) {
    if (excludeAccountIds.has(state.account.id)) {
      continue
    }

    if (!RECOVERABLE_STATUSES.has(state.status)) {
      continue
    }

    const runtime = { ...state.runtime }
    let status = state.status

    if (status === "rate_limited") {
      if (runtime.resetAt && current >= runtime.resetAt) {
        status = "active"
        runtime.usedPercent = 0
        runtime.errorCount = 0
        runtime.resetAt = null
      } else {
        continue
      }
    }

    if (status === "quota_exceeded") {
      if (runtime.resetAt && current >= runtime.resetAt) {
        status = "active"
        runtime.usedPercent = 0
        runtime.secondaryUsedPercent = 0
        runtime.resetAt = null
      } else {
        continue
      }
    }

    if (runtime.cooldownUntil && current >= runtime.cooldownUntil) {
      runtime.cooldownUntil = null
      runtime.lastErrorAt = null
      runtime.errorCount = 0
    }

    if (runtime.cooldownUntil && current < runtime.cooldownUntil) {
      continue
    }

    if (isUsageExhausted({ ...state, runtime, status })) {
      continue
    }

    if (runtime.errorCount >= 3) {
      const backoff = backoffSeconds(runtime.errorCount)

      if (runtime.lastErrorAt && current - runtime.lastErrorAt < backoff) {
        inErrorBackoff.push({ ...state, runtime, status })
        continue
      }

      runtime.errorCount = 0
      runtime.lastErrorAt = null
    }

    available.push({ ...state, runtime, status })
  }

  return { available, inErrorBackoff, allStates: states }
}

function unavailableMessage(
  allStates: Array<BalancerAccountState>,
  current: number
) {
  const rateLimited = allStates.filter(
    (state) => state.status === "rate_limited"
  )
  const quotaExceeded = allStates.filter(
    (state) => state.status === "quota_exceeded"
  )
  const paused = allStates.filter((state) => state.status === "paused")
  const deactivated = allStates.filter(
    (state) => state.status === "deactivated"
  )
  const reauthRequired = allStates.filter(
    (state) => state.status === "reauth_required"
  )

  if (quotaExceeded.length > 0) {
    const resetCandidates = quotaExceeded
      .map((state) => state.runtime.resetAt)
      .filter((value): value is number => value !== null)

    if (resetCandidates.length > 0) {
      const waitSeconds = Math.max(0, Math.min(...resetCandidates) - current)
      return formatRetryHint(waitSeconds)
    }
  }

  const cooldowns = allStates
    .map((state) => state.runtime.cooldownUntil)
    .filter((value): value is number => value !== null && value > current)

  if (cooldowns.length > 0) {
    const waitSeconds = Math.max(0, Math.min(...cooldowns) - current)
    return formatRetryHint(waitSeconds)
  }

  if (paused.length > 0 && reauthRequired.length > 0) {
    return "All accounts are paused or require re-authentication"
  }

  if (paused.length > 0 && deactivated.length > 0) {
    return "All accounts are paused or deactivated"
  }

  if (rateLimited.length > 0) {
    return "All accounts are rate limited"
  }

  if (quotaExceeded.length > 0) {
    return "All accounts have exceeded their quota"
  }

  if (paused.length > 0) {
    return "All accounts are paused"
  }

  if (reauthRequired.length > 0) {
    return "All accounts require re-authentication"
  }

  if (deactivated.length > 0) {
    return "All accounts are deactivated"
  }

  return "No available accounts"
}

export function selectAccount(
  states: Array<BalancerAccountState>,
  options: {
    now?: number
    excludeAccountIds?: Set<string>
  } = {}
): SelectionResult {
  const current = options.now ?? Date.now() / 1000
  const excludeAccountIds = options.excludeAccountIds ?? new Set<string>()
  const { available, inErrorBackoff, allStates } = applyAvailabilityFilters(
    states,
    current,
    excludeAccountIds
  )

  let candidates = available

  if (candidates.length === 0 && inErrorBackoff.length > 0) {
    const nearestRecovery = inErrorBackoff.reduce((best, state) => {
      const backoff = backoffSeconds(state.runtime.errorCount)
      const expiresAt = (state.runtime.lastErrorAt || 0) + backoff

      if (!best) {
        return { state, expiresAt }
      }

      return expiresAt < best.expiresAt ? { state, expiresAt } : best
    }, null as { state: BalancerAccountState; expiresAt: number } | null)

    if (nearestRecovery) {
      candidates = [nearestRecovery.state]
    }
  }

  if (candidates.length === 0) {
    return {
      account: null,
      errorMessage: unavailableMessage(allStates, current),
    }
  }

  const winner = candidates.reduce((best, candidate) => {
    const bestKey = usageSortKey(best)
    const candidateKey = usageSortKey(candidate)

    for (let index = 0; index < bestKey.length; index += 1) {
      if (candidateKey[index] < bestKey[index]) {
        return candidate
      }

      if (candidateKey[index] > bestKey[index]) {
        return best
      }
    }

    return best
  })

  updateAccountRuntime(winner.account.id, winner.runtime)
  return { account: winner.account, errorMessage: null }
}

export function handleRateLimit(
  accountId: string,
  error: UpstreamError,
  status: AccountStatus = "rate_limited"
) {
  const runtime = getAccountRuntime(accountId)
  const resetAt = extractResetAt(error)
  const delay =
    parseRetryAfter(error.message) ?? backoffSeconds(runtime.errorCount + 1)
  const now = Date.now() / 1000

  updateAccountRuntime(accountId, {
    ...runtime,
    errorCount: runtime.errorCount + 1,
    lastErrorAt: now,
    resetAt: resetAt ?? runtime.resetAt,
    cooldownUntil: now + delay,
  })

  return status
}

export function handleQuotaExceeded(accountId: string, error: UpstreamError) {
  const runtime = getAccountRuntime(accountId)
  const resetAt = extractResetAt(error)
  const now = Date.now() / 1000

  updateAccountRuntime(accountId, {
    ...runtime,
    usedPercent: 100,
    secondaryUsedPercent: 100,
    resetAt: resetAt ?? Math.floor(now + 3600),
    cooldownUntil: now + QUOTA_EXCEEDED_COOLDOWN_SECONDS,
  })

  return "quota_exceeded" as const
}

export function syncRuntimeUsage(
  accountId: string,
  usage: {
    primaryUsedPercent: number | null
    secondaryUsedPercent: number | null
    primaryResetAt: number | null
    secondaryResetAt: number | null
  }
) {
  const runtime = getAccountRuntime(accountId)

  updateAccountRuntime(accountId, {
    ...runtime,
    usedPercent: usage.primaryUsedPercent,
    secondaryUsedPercent: usage.secondaryUsedPercent,
    resetAt: usage.secondaryResetAt ?? usage.primaryResetAt ?? runtime.resetAt,
  })
}

export type { AccountRuntimeState }
