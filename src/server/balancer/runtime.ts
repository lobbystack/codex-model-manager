import type { AccountRuntimeState } from "./types"

const runtimeByAccountId = new Map<string, AccountRuntimeState>()

function defaultRuntime(): AccountRuntimeState {
  return {
    cooldownUntil: null,
    resetAt: null,
    errorCount: 0,
    lastErrorAt: null,
    lastSelectedAt: null,
    usedPercent: null,
    secondaryUsedPercent: null,
  }
}

export function getAccountRuntime(accountId: string): AccountRuntimeState {
  const existing = runtimeByAccountId.get(accountId)

  if (existing) {
    return existing
  }

  const created = defaultRuntime()
  runtimeByAccountId.set(accountId, created)
  return created
}

export function updateAccountRuntime(
  accountId: string,
  patch: Partial<AccountRuntimeState>
) {
  const current = getAccountRuntime(accountId)
  const next = { ...current, ...patch }
  runtimeByAccountId.set(accountId, next)
  return next
}

export function markAccountSelected(accountId: string) {
  return updateAccountRuntime(accountId, {
    lastSelectedAt: Date.now() / 1000,
  })
}

export function clearAccountRuntime(accountId: string) {
  runtimeByAccountId.delete(accountId)
}
