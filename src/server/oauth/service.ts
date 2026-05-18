import { randomBytes } from "node:crypto"

import {
  getActiveAccount,
  getDecryptedTokens,
  updateAccountTokens,
  upsertAccountFromTokens,
} from "../accounts/store"
import {
  OAuthError,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  exchangeDeviceToken,
  generatePkcePair,
  getRedirectUri,
  refreshAccessToken,
  requestDeviceCode,
} from "./client"

type OAuthMethod = "browser" | "device"
type OAuthStatus = "idle" | "pending" | "success" | "error"

type OAuthState = {
  status: OAuthStatus
  method: OAuthMethod | null
  errorMessage: string | null
  stateToken: string | null
  codeVerifier: string | null
  deviceAuthId: string | null
  userCode: string | null
  intervalSeconds: number | null
  expiresAt: number | null
  pollTask: Promise<void> | null
}

type StartRequest = {
  forceMethod?: "browser" | "device"
}

type CompleteRequest = {
  deviceAuthId?: string
  userCode?: string
}

const state: OAuthState = {
  status: "idle",
  method: null,
  errorMessage: null,
  stateToken: null,
  codeVerifier: null,
  deviceAuthId: null,
  userCode: null,
  intervalSeconds: null,
  expiresAt: null,
  pollTask: null,
}

function resetState() {
  state.status = "idle"
  state.method = null
  state.errorMessage = null
  state.stateToken = null
  state.codeVerifier = null
  state.deviceAuthId = null
  state.userCode = null
  state.intervalSeconds = null
  state.expiresAt = null
  state.pollTask = null
}

function setError(message: string) {
  state.status = "error"
  state.errorMessage = message
}

function setSuccess() {
  state.status = "success"
  state.errorMessage = null
}

function sleep(seconds: number) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000))
}

async function pollDeviceTokens() {
  try {
    while (state.expiresAt && Date.now() < state.expiresAt) {
      if (!state.deviceAuthId || !state.userCode) {
        setError("Device code flow is not initialized.")
        return
      }

      const tokens = await exchangeDeviceToken(state.deviceAuthId, state.userCode)

      if (tokens) {
        await upsertAccountFromTokens(tokens)
        setSuccess()
        return
      }

      await sleep(Math.max(state.intervalSeconds || 1, 1))
    }

    setError("Device code expired.")
  } catch (error) {
    setError(error instanceof Error ? error.message : "Device authorization failed")
  } finally {
    state.pollTask = null
  }
}

function ensureDevicePollTask() {
  if (state.pollTask) {
    return true
  }

  if (!state.deviceAuthId || !state.userCode || !state.expiresAt) {
    return false
  }

  state.pollTask = pollDeviceTokens()
  return true
}

export async function startOAuth(request: StartRequest = {}) {
  resetState()

  if (request.forceMethod === "device") {
    const device = await requestDeviceCode()
    state.status = "pending"
    state.method = "device"
    state.deviceAuthId = device.deviceAuthId
    state.userCode = device.userCode
    state.intervalSeconds = device.intervalSeconds
    state.expiresAt = Date.now() + device.expiresInSeconds * 1000
    ensureDevicePollTask()

    return {
      method: "device",
      verificationUrl: device.verificationUrl,
      userCode: device.userCode,
      deviceAuthId: device.deviceAuthId,
      intervalSeconds: device.intervalSeconds,
      expiresInSeconds: device.expiresInSeconds,
    }
  }

  const pkce = generatePkcePair()
  const stateToken = randomBytes(16).toString("base64url")
  state.status = "pending"
  state.method = "browser"
  state.stateToken = stateToken
  state.codeVerifier = pkce.verifier

  return {
    method: "browser",
    authorizationUrl: buildAuthorizationUrl(stateToken, pkce.challenge),
    callbackUrl: getRedirectUri(),
  }
}

export function getOAuthStatus() {
  return {
    status: state.status === "idle" ? "pending" : state.status,
    errorMessage: state.errorMessage,
  }
}

export function completeOAuth(request: CompleteRequest = {}) {
  if (request.deviceAuthId) {
    state.deviceAuthId = request.deviceAuthId
  }

  if (request.userCode) {
    state.userCode = request.userCode
  }

  if (state.status === "success") {
    return { status: "success" }
  }

  if (state.method !== "device") {
    return { status: "pending" }
  }

  if (!ensureDevicePollTask()) {
    setError("Device code flow is not initialized.")
    return { status: "error" }
  }

  return { status: "pending" }
}

export async function completeBrowserCallback(url: URL) {
  const callbackError = url.searchParams.get("error")
  const code = url.searchParams.get("code")
  const callbackState = url.searchParams.get("state")

  if (callbackError) {
    const message = `OAuth error: ${callbackError}`
    setError(message)
    return { status: "error", errorMessage: message }
  }

  if (!code || !callbackState || callbackState !== state.stateToken || !state.codeVerifier) {
    const message = "Invalid OAuth callback: state mismatch or missing code."
    setError(message)
    return { status: "error", errorMessage: message }
  }

  try {
    const tokens = await exchangeAuthorizationCode(code, state.codeVerifier)
    await upsertAccountFromTokens(tokens)
    setSuccess()
    return { status: "success", errorMessage: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : "OAuth callback failed"
    setError(message)
    return { status: "error", errorMessage: message }
  }
}

export async function completeManualCallback(callbackUrl: string) {
  return completeBrowserCallback(new URL(callbackUrl))
}

export async function getActiveAccessToken() {
  const account = await getActiveAccount()

  if (!account) {
    return null
  }

  const tokens = await getDecryptedTokens(account)
  const lastRefresh = Date.parse(account.lastRefresh)
  const shouldRefresh =
    Number.isNaN(lastRefresh) || Date.now() - lastRefresh > 8 * 24 * 60 * 60 * 1000

  if (!shouldRefresh) {
    return tokens.accessToken
  }

  try {
    const refreshed = await refreshAccessToken(tokens.refreshToken)
    await updateAccountTokens(account, refreshed)
    return refreshed.accessToken
  } catch (refreshError) {
    if (refreshError instanceof OAuthError) {
      return tokens.accessToken
    }

    throw refreshError
  }
}
