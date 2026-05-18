import { createHash, randomBytes } from "node:crypto"

import type { OAuthTokens } from "../accounts/types"

export type DeviceCode = {
  verificationUrl: string
  userCode: string
  deviceAuthId: string
  intervalSeconds: number
  expiresInSeconds: number
}

export class OAuthError extends Error {
  code: string
  statusCode: number | null

  constructor(code: string, message: string, statusCode: number | null = null) {
    super(message)
    this.name = "OAuthError"
    this.code = code
    this.statusCode = statusCode
  }
}

type TokenPayload = {
  access_token?: string
  refresh_token?: string
  id_token?: string
  authorization_code?: string
  code_verifier?: string
  error?: string | { code?: string; error?: string; message?: string; error_description?: string }
  error_description?: string
  error_code?: string
  code?: string
  message?: string
  status?: string
}

type DevicePayload = {
  device_auth_id?: string
  user_code?: string
  usercode?: string
  interval?: number | string
  expires_in?: number
  expires_at?: string
}

const AUTH_BASE_URL = "https://auth.openai.com"
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const ORIGINATOR = "codex_chatgpt_desktop"
const SCOPE = "openid profile email offline_access"
const TIMEOUT_MS = 30_000

function redirectUri() {
  return process.env.CMM_OAUTH_REDIRECT_URI || "http://localhost:1455/auth/callback"
}

function authBaseUrl() {
  return (process.env.CMM_AUTH_BASE_URL || AUTH_BASE_URL).replace(/\/$/, "")
}

function clientId() {
  return process.env.CMM_OAUTH_CLIENT_ID || CLIENT_ID
}

function originator() {
  return process.env.CMM_OAUTH_ORIGINATOR || ORIGINATOR
}

function scope() {
  const configured = process.env.CMM_OAUTH_SCOPE || SCOPE
  return configured.split(/\s+/).includes("offline_access")
    ? configured
    : `${configured} offline_access`
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function safeJson(response: Response) {
  try {
    const data = (await response.json()) as unknown
    return data && typeof data === "object" ? (data as TokenPayload) : {}
  } catch {
    return { error: { message: await response.text() } }
  }
}

function parseTokens(payload: TokenPayload): OAuthTokens {
  if (!payload.access_token || !payload.refresh_token || !payload.id_token) {
    throw new OAuthError("invalid_response", "OAuth response missing tokens")
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    idToken: payload.id_token,
  }
}

function errorCode(payload: TokenPayload) {
  if (typeof payload.error === "string") {
    return payload.error
  }

  return payload.error?.code || payload.error?.error || payload.error_code || payload.code
}

function errorMessage(payload: TokenPayload) {
  if (typeof payload.error === "string") {
    return payload.error_description || payload.error
  }

  return (
    payload.error?.message ||
    payload.error?.error_description ||
    payload.message ||
    payload.error_description
  )
}

function oauthError(payload: TokenPayload, status: number) {
  return new OAuthError(
    errorCode(payload) || `http_${status}`,
    errorMessage(payload) || `OAuth request failed (${status})`,
    status
  )
}

function isPending(payload: TokenPayload) {
  const code = errorCode(payload)
  return (
    code === "authorization_pending" ||
    code === "slow_down" ||
    payload.status?.toLowerCase() === "pending" ||
    payload.status?.toLowerCase() === "authorization_pending"
  )
}

function expiresInSeconds(expiresAt: string | undefined) {
  if (!expiresAt) {
    return null
  }

  const expires = Date.parse(expiresAt)

  if (Number.isNaN(expires)) {
    return null
  }

  return Math.max(0, Math.floor((expires - Date.now()) / 1000))
}

export function generatePkcePair() {
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  return { verifier, challenge }
}

export function buildAuthorizationUrl(state: string, codeChallenge: string) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId(),
    redirect_uri: redirectUri(),
    scope: scope(),
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: originator(),
  })

  return `${authBaseUrl()}/oauth/authorize?${params.toString()}`
}

export function getRedirectUri() {
  return redirectUri()
}

export async function exchangeAuthorizationCode(code: string, codeVerifier: string) {
  const payload = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId(),
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri(),
  })

  const response = await fetchWithTimeout(`${authBaseUrl()}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: payload.toString(),
  })
  const data = await safeJson(response)

  if (!response.ok) {
    throw oauthError(data, response.status)
  }

  return parseTokens(data)
}

export async function requestDeviceCode(): Promise<DeviceCode> {
  const response = await fetchWithTimeout(
    `${authBaseUrl()}/api/accounts/deviceauth/usercode`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: clientId() }),
    }
  )
  const data = (await safeJson(response)) as DevicePayload & TokenPayload

  if (!response.ok) {
    throw oauthError(data, response.status)
  }

  const userCode = data.user_code || data.usercode
  const intervalSeconds = Number(data.interval || 0)
  const expires = data.expires_in || expiresInSeconds(data.expires_at) || 900

  if (!data.device_auth_id || !userCode) {
    throw new OAuthError("invalid_response", "Device auth response missing fields")
  }

  return {
    verificationUrl: `${authBaseUrl()}/codex/device`,
    userCode,
    deviceAuthId: data.device_auth_id,
    intervalSeconds,
    expiresInSeconds: expires,
  }
}

export async function exchangeDeviceToken(
  deviceAuthId: string,
  userCode: string
): Promise<OAuthTokens | null> {
  const response = await fetchWithTimeout(
    `${authBaseUrl()}/api/accounts/deviceauth/token`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
    }
  )
  const data = await safeJson(response)

  if (response.status === 403 || response.status === 404 || isPending(data)) {
    return null
  }

  if (!response.ok) {
    throw oauthError(data, response.status)
  }

  if (data.authorization_code) {
    if (!data.code_verifier) {
      throw new OAuthError(
        "invalid_response",
        "Device auth response missing code verifier"
      )
    }

    return exchangeAuthorizationCode(data.authorization_code, data.code_verifier)
  }

  return parseTokens(data)
}

export async function refreshAccessToken(refreshToken: string) {
  const response = await fetchWithTimeout(`${authBaseUrl()}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: clientId(),
      refresh_token: refreshToken,
      scope: scope(),
    }),
  })
  const data = await safeJson(response)

  if (!response.ok) {
    throw oauthError(data, response.status)
  }

  return parseTokens(data)
}
