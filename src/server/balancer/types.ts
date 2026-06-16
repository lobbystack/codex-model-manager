import type { AccountStatus, StoredAccount } from "@/server/accounts/types"

export type FailureClass =
  | "rate_limit"
  | "quota"
  | "retryable_transient"
  | "non_retryable"

export type FailurePhase = "connect" | "first_event" | "mid_stream"

export type UpstreamError = {
  message?: string
  resets_at?: number
  resets_in_seconds?: number
}

export type ClassifiedFailure = {
  failureClass: FailureClass
  phase: FailurePhase
  errorCode: string
  error: UpstreamError
  httpStatus: number | null
}

export type FailoverAction = "failover_next" | "surface"

export type AccountRuntimeState = {
  cooldownUntil: number | null
  resetAt: number | null
  errorCount: number
  lastErrorAt: number | null
  lastSelectedAt: number | null
  usedPercent: number | null
  secondaryUsedPercent: number | null
}

export type BalancerAccountState = {
  account: StoredAccount
  status: AccountStatus
  runtime: AccountRuntimeState
}

export type SelectionResult = {
  account: StoredAccount | null
  errorMessage: string | null
}
