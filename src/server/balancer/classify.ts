import type {
  ClassifiedFailure,
  FailureClass,
  FailurePhase,
  UpstreamError,
} from "./types"

const RATE_LIMIT_CODES = new Set(["rate_limit_exceeded", "usage_limit_reached"])

const QUOTA_CODES = new Set([
  "quota_exceeded",
  "insufficient_quota",
  "billing_hard_limit_reached",
])

const TRANSIENT_CODES = new Set(["server_error", "upstream_error", "timeout"])

export function classifyUpstreamFailure(input: {
  errorCode: string
  error: UpstreamError
  httpStatus: number | null
  phase: FailurePhase
}): ClassifiedFailure {
  let failureClass: FailureClass = "non_retryable"

  if (
    RATE_LIMIT_CODES.has(input.errorCode) ||
    input.httpStatus === 429
  ) {
    failureClass = "rate_limit"
  } else if (QUOTA_CODES.has(input.errorCode)) {
    failureClass = "quota"
  } else if (
    TRANSIENT_CODES.has(input.errorCode) ||
    (input.httpStatus !== null && input.httpStatus >= 500)
  ) {
    failureClass = "retryable_transient"
  }

  return {
    failureClass,
    phase: input.phase,
    errorCode: input.errorCode,
    error: input.error,
    httpStatus: input.httpStatus,
  }
}

export function failoverDecision(input: {
  failureClass: FailureClass
  downstreamVisible: boolean
  candidatesRemaining: number
}): "failover_next" | "surface" {
  if (input.downstreamVisible) {
    return "surface"
  }

  if (input.candidatesRemaining <= 0) {
    return "surface"
  }

  if (
    input.failureClass === "rate_limit" ||
    input.failureClass === "quota" ||
    input.failureClass === "retryable_transient"
  ) {
    return "failover_next"
  }

  return "surface"
}

export function extractUpstreamError(payload: unknown): UpstreamError {
  if (!payload || typeof payload !== "object") {
    return {}
  }

  const record = payload as Record<string, unknown>
  const error =
    record.error && typeof record.error === "object"
      ? (record.error as Record<string, unknown>)
      : record
  const response =
    record.response && typeof record.response === "object"
      ? (record.response as Record<string, unknown>)
      : null
  const responseError =
    response?.error && typeof response.error === "object"
      ? (response.error as Record<string, unknown>)
      : null
  const source = responseError || error

  const message =
    typeof source.message === "string"
      ? source.message
      : typeof error.message === "string"
        ? error.message
        : undefined

  const resetsAt =
    typeof source.resets_at === "number"
      ? source.resets_at
      : typeof error.resets_at === "number"
        ? error.resets_at
        : undefined

  const resetsInSeconds =
    typeof source.resets_in_seconds === "number"
      ? source.resets_in_seconds
      : typeof error.resets_in_seconds === "number"
        ? error.resets_in_seconds
        : undefined

  return {
    message,
    resets_at: resetsAt,
    resets_in_seconds: resetsInSeconds,
  }
}

export function extractErrorCode(payload: unknown, statusCode: number) {
  if (!payload || typeof payload !== "object") {
    return statusCode === 429 ? "rate_limit_exceeded" : `http_${statusCode}`
  }

  const record = payload as Record<string, unknown>
  const error =
    record.error && typeof record.error === "object"
      ? (record.error as Record<string, unknown>)
      : null
  const response =
    record.response && typeof record.response === "object"
      ? (record.response as Record<string, unknown>)
      : null
  const responseError =
    response?.error && typeof response.error === "object"
      ? (response.error as Record<string, unknown>)
      : null

  const code =
    (typeof responseError?.code === "string" && responseError.code) ||
    (typeof error?.code === "string" && error.code) ||
    (typeof error?.type === "string" && error.type) ||
    (statusCode === 429 ? "rate_limit_exceeded" : `http_${statusCode}`)

  return code
}
