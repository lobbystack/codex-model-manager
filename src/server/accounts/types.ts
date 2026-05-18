export type AccountStatus = "active" | "paused" | "deactivated"

export type StoredAccount = {
  id: string
  chatgptAccountId: string | null
  email: string
  planType: string
  accessTokenEncrypted: string
  refreshTokenEncrypted: string
  idTokenEncrypted: string
  lastRefresh: string
  createdAt: string
  status: AccountStatus
  deactivationReason: string | null
}

export type PublicAccount = {
  id: string
  chatgptAccountId: string | null
  email: string
  planType: string
  lastRefresh: string
  createdAt: string
  status: AccountStatus
  deactivationReason: string | null
}

export type StoredApiKeyProvider = {
  id: string
  type: "openrouter"
  name: string
  keyEncrypted: string
  keyPrefix: string
  createdAt: string
  updatedAt: string
  status: "active"
}

export type PublicApiKeyProvider = Omit<StoredApiKeyProvider, "keyEncrypted">

export type StoredOpenRouterModel = {
  id: string
  displayName: string
  providerName: string
  upstreamModel: string
  enabled: boolean
  supportsReasoning?: boolean
  supportedParameters?: Array<string>
  contextWindow: number
  outputLimit: number
  updatedAt: string
}

export type PublicOpenRouterModel = StoredOpenRouterModel

export type OAuthTokens = {
  accessToken: string
  refreshToken: string
  idToken: string
}

export type TokenRefreshResult = OAuthTokens & {
  accountId: string | null
  email: string | null
  planType: string | null
}
