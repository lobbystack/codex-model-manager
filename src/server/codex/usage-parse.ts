import type { UsageLimitSummary, UsageLimitWindow } from "./usage-limit"

const WINDOW_MINUTES_PRIMARY = 300
const WINDOW_MINUTES_SECONDARY = 10080
const WINDOW_MINUTES_MONTHLY = 43200

type RawUsageWindow = {
  usedPercent: number | null
  resetAt: number | null
  limitWindowSeconds: number | null
  resetAfterSeconds: number | null
}

type RawWhamUsagePayload = {
  planType: string | null
  rateLimitAllowed: boolean | null
  rateLimitReached: boolean | null
  primaryWindow: RawUsageWindow | null
  secondaryWindow: RawUsageWindow | null
  creditsHas: boolean | null
  creditsUnlimited: boolean | null
  creditsBalance: number | null
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function booleanOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null
}

function windowMinutesFromSeconds(limitWindowSeconds: number | null) {
  if (limitWindowSeconds === null) {
    return null
  }

  return Math.round(limitWindowSeconds / 60)
}

function isWeeklyWindowMinutes(windowMinutes: number | null) {
  return windowMinutes === WINDOW_MINUTES_SECONDARY
}

function isPrimaryWindowMinutes(windowMinutes: number | null) {
  return windowMinutes === WINDOW_MINUTES_PRIMARY
}

function parseRawWindow(
  payload: Record<string, unknown> | null | undefined
): RawUsageWindow | null {
  if (!payload) {
    return null
  }

  return {
    usedPercent: numberOrNull(payload.used_percent),
    resetAt: numberOrNull(payload.reset_at),
    limitWindowSeconds: numberOrNull(payload.limit_window_seconds),
    resetAfterSeconds: numberOrNull(payload.reset_after_seconds),
  }
}

function shouldUseWeeklyPrimary(
  primary: RawUsageWindow,
  secondary: RawUsageWindow | null
) {
  if (!isWeeklyWindowMinutes(windowMinutesFromSeconds(primary.limitWindowSeconds))) {
    return false
  }

  if (!secondary) {
    return true
  }

  if (primary.resetAt !== null && secondary.resetAt !== null) {
    if (primary.resetAt !== secondary.resetAt) {
      return primary.resetAt > secondary.resetAt
    }
  } else if (primary.resetAt !== null) {
    return true
  } else if (secondary.resetAt !== null) {
    return false
  }

  return true
}

function effectiveUsageWindows(
  primary: RawUsageWindow | null,
  secondary: RawUsageWindow | null
) {
  if (!primary) {
    return {
      primaryWindow: null,
      secondaryWindow: secondary,
      weeklyOnly: false,
    }
  }

  if (!isWeeklyWindowMinutes(windowMinutesFromSeconds(primary.limitWindowSeconds))) {
    return {
      primaryWindow: primary,
      secondaryWindow: secondary,
      weeklyOnly: false,
    }
  }

  if (!secondary) {
    return {
      primaryWindow: null,
      secondaryWindow: primary,
      weeklyOnly: true,
    }
  }

  if (shouldUseWeeklyPrimary(primary, secondary)) {
    return {
      primaryWindow: null,
      secondaryWindow: primary,
      weeklyOnly: true,
    }
  }

  return {
    primaryWindow: null,
    secondaryWindow: secondary,
    weeklyOnly: true,
  }
}

function normalizeRateLimitWindows(
  primary: RawUsageWindow | null,
  secondary: RawUsageWindow | null
) {
  if (
    primary &&
    windowMinutesFromSeconds(primary.limitWindowSeconds) ===
      WINDOW_MINUTES_MONTHLY &&
    !secondary
  ) {
    return {
      primaryWindow: null,
      secondaryWindow: null,
      monthlyWindow: primary,
      weeklyOnly: false,
    }
  }

  return {
    ...effectiveUsageWindows(primary, secondary),
    monthlyWindow: null as RawUsageWindow | null,
  }
}

function hasUsableCredits(input: {
  creditsHas: boolean | null
  creditsUnlimited: boolean | null
  creditsBalance: number | null
}) {
  if (input.creditsUnlimited === true) {
    return true
  }

  if (input.creditsHas === true) {
    return true
  }

  if (input.creditsBalance === null) {
    return false
  }

  return input.creditsBalance > 0
}

function remainingPercentFromUsed(
  usedPercent: number | null,
  options: {
    limitReached: boolean | null
    hasCredits: boolean
  }
) {
  if (usedPercent === null) {
    return null
  }

  if (usedPercent >= 100 && options.limitReached === false) {
    return null
  }

  if (usedPercent >= 100 && options.hasCredits) {
    return null
  }

  return Math.max(0, Math.min(100, 100 - usedPercent))
}

function toUsageWindow(
  window: RawUsageWindow | null,
  options: {
    limitReached: boolean | null
    hasCredits: boolean
  }
): UsageLimitWindow | null {
  if (!window) {
    return null
  }

  const usedPercent = window.usedPercent

  return {
    usedPercent,
    remainingPercent: remainingPercentFromUsed(usedPercent, options),
    resetAt: window.resetAt,
    limitWindowSeconds: window.limitWindowSeconds,
    resetAfterSeconds: window.resetAfterSeconds,
  }
}

export function parseWhamUsagePayload(
  payload: Record<string, unknown>
): UsageLimitSummary {
  const rateLimit =
    payload.rate_limit && typeof payload.rate_limit === "object"
      ? (payload.rate_limit as Record<string, unknown>)
      : null
  const credits =
    payload.credits && typeof payload.credits === "object"
      ? (payload.credits as Record<string, unknown>)
      : null

  const raw: RawWhamUsagePayload = {
    planType: typeof payload.plan_type === "string" ? payload.plan_type : null,
    rateLimitAllowed: booleanOrNull(rateLimit?.allowed),
    rateLimitReached: booleanOrNull(rateLimit?.limit_reached),
    primaryWindow: parseRawWindow(
      rateLimit?.primary_window as Record<string, unknown> | null | undefined
    ),
    secondaryWindow: parseRawWindow(
      rateLimit?.secondary_window as Record<string, unknown> | null | undefined
    ),
    creditsHas: booleanOrNull(credits?.has_credits),
    creditsUnlimited: booleanOrNull(credits?.unlimited),
    creditsBalance: numberOrNull(
      credits?.balance !== undefined ? Number(credits.balance) : null
    ),
  }

  const normalized = normalizeRateLimitWindows(
    raw.primaryWindow,
    raw.secondaryWindow
  )
  const weeklyWindow =
    normalized.secondaryWindow ?? normalized.monthlyWindow ?? null
  const hasCredits = hasUsableCredits(raw)
  const displayOptions = {
    limitReached: raw.rateLimitReached,
    hasCredits,
  }

  return {
    planType: raw.planType,
    primaryWindow: toUsageWindow(normalized.primaryWindow, displayOptions),
    secondaryWindow: toUsageWindow(weeklyWindow, displayOptions),
    weeklyOnly: normalized.weeklyOnly,
    limitReached: raw.rateLimitReached,
    allowed: raw.rateLimitAllowed,
    creditsBalance: raw.creditsBalance,
    hasCredits,
  }
}

export function deriveQuotaExceeded(summary: UsageLimitSummary) {
  if (summary.hasCredits) {
    return false
  }

  if (summary.limitReached === false) {
    return false
  }

  const primaryUsed = summary.primaryWindow?.usedPercent
  const secondaryUsed = summary.secondaryWindow?.usedPercent

  if (secondaryUsed !== null && secondaryUsed !== undefined && secondaryUsed >= 100) {
    return true
  }

  if (primaryUsed !== null && primaryUsed !== undefined && primaryUsed >= 100) {
    return true
  }

  return false
}

export function isWeeklyOnlyPlan(summary: UsageLimitSummary) {
  return summary.weeklyOnly === true
}

export {
  isPrimaryWindowMinutes,
  isWeeklyWindowMinutes,
  windowMinutesFromSeconds,
}
