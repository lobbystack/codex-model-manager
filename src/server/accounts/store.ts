import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import type {
  OAuthTokens,
  PublicAccount,
  PublicApiKeyProvider,
  PublicChatGptModel,
  PublicOpenRouterModel,
  StoredAccount,
  StoredApiKeyProvider,
  StoredChatGptModel,
  StoredOpenRouterModel,
} from "./types"

type StoreFile = {
  accounts: Array<StoredAccount>
  apiKeyProviders: Array<StoredApiKeyProvider>
  openRouterModels: Array<StoredOpenRouterModel>
  chatGptModels: Array<StoredChatGptModel>
}

const DEFAULT_EMAIL = "unknown@example.com"
const DEFAULT_PLAN = "unknown"

let writeQueue = Promise.resolve()

function dataDir() {
  return process.env.CMM_DATA_DIR || join(homedir(), ".codex-model-manager")
}

function storePath() {
  return join(dataDir(), "accounts.json")
}

function keyPath() {
  return (
    process.env.CMM_ENCRYPTION_KEY_FILE || join(dataDir(), "encryption.key")
  )
}

async function getEncryptionKey() {
  const path = keyPath()

  try {
    const encoded = await readFile(path, "utf8")
    return Buffer.from(encoded.trim(), "base64")
  } catch {
    const key = randomBytes(32)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, key.toString("base64"), { mode: 0o600 })
    return key
  }
}

async function encryptToken(token: string) {
  const key = await getEncryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString("base64")
}

async function decryptToken(encryptedToken: string) {
  const key = await getEncryptionKey()
  const payload = Buffer.from(encryptedToken, "base64")
  const iv = payload.subarray(0, 12)
  const tag = payload.subarray(12, 28)
  const encrypted = payload.subarray(28)
  const decipher = createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8"
  )
}

async function readStore(): Promise<StoreFile> {
  try {
    const raw = await readFile(storePath(), "utf8")
    const parsed = JSON.parse(raw) as Partial<StoreFile>
    return {
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      apiKeyProviders: Array.isArray(parsed.apiKeyProviders)
        ? parsed.apiKeyProviders
        : [],
      openRouterModels: Array.isArray(parsed.openRouterModels)
        ? parsed.openRouterModels
        : [],
      chatGptModels: Array.isArray(parsed.chatGptModels)
        ? parsed.chatGptModels
        : [],
    }
  } catch {
    return {
      accounts: [],
      apiKeyProviders: [],
      openRouterModels: [],
      chatGptModels: [],
    }
  }
}

async function writeStore(store: StoreFile) {
  const path = storePath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 })
}

function toPublicAccount(account: StoredAccount): PublicAccount {
  return {
    id: account.id,
    chatgptAccountId: account.chatgptAccountId,
    email: account.email,
    planType: account.planType,
    lastRefresh: account.lastRefresh,
    createdAt: account.createdAt,
    status: account.status,
    deactivationReason: account.deactivationReason,
  }
}

function toPublicApiKeyProvider(
  provider: StoredApiKeyProvider
): PublicApiKeyProvider {
  return {
    id: provider.id,
    type: provider.type,
    name: provider.name,
    keyPrefix: provider.keyPrefix,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
    status: provider.status,
  }
}

function keyPrefix(key: string) {
  const trimmed = key.trim()
  return trimmed.length <= 14
    ? trimmed
    : `${trimmed.slice(0, 10)}...${trimmed.slice(-4)}`
}

function fallbackAccountId(email: string | null) {
  if (email && email !== DEFAULT_EMAIL) {
    return `email_${Buffer.from(email).toString("base64url").slice(0, 12)}`
  }

  return `local_${randomBytes(6).toString("hex")}`
}

export function extractIdTokenClaims(idToken: string) {
  try {
    const payload = idToken.split(".")[1]

    if (!payload) {
      return {}
    }

    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string
      chatgpt_account_id?: string
      chatgpt_plan_type?: string
      "https://api.openai.com/auth"?: {
        chatgpt_account_id?: string
        chatgpt_plan_type?: string
      }
    }
  } catch {
    return {}
  }
}

export function getClaimsFromIdToken(idToken: string) {
  const claims = extractIdTokenClaims(idToken)
  const authClaims = claims["https://api.openai.com/auth"] || {}
  const chatgptAccountId =
    authClaims.chatgpt_account_id || claims.chatgpt_account_id || null
  const email = claims.email || DEFAULT_EMAIL
  const planType =
    authClaims.chatgpt_plan_type || claims.chatgpt_plan_type || DEFAULT_PLAN

  return { chatgptAccountId, email, planType }
}

export function generateAccountId(
  chatgptAccountId: string | null,
  email: string
) {
  if (chatgptAccountId && email !== DEFAULT_EMAIL) {
    const emailHash = Buffer.from(email).toString("base64url").slice(0, 8)
    return `${chatgptAccountId}_${emailHash}`
  }

  return chatgptAccountId || fallbackAccountId(email)
}

export async function listAccounts() {
  const store = await readStore()
  return store.accounts.map(toPublicAccount)
}

export async function listApiKeyProviders() {
  const store = await readStore()
  return store.apiKeyProviders.map(toPublicApiKeyProvider)
}

export async function listOpenRouterModelSettings(): Promise<
  Array<PublicOpenRouterModel>
> {
  const store = await readStore()
  return store.openRouterModels
}

export async function listChatGptModelSettings(): Promise<
  Array<PublicChatGptModel>
> {
  const store = await readStore()
  return store.chatGptModels
}

export async function upsertChatGptModelSetting(
  model: Omit<StoredChatGptModel, "updatedAt">
): Promise<PublicChatGptModel> {
  const now = new Date().toISOString()
  const nextModel = { ...model, updatedAt: now }

  writeQueue = writeQueue.then(async () => {
    const store = await readStore()
    const existing = store.chatGptModels.findIndex(
      (candidate) => candidate.id === nextModel.id
    )

    if (existing >= 0) {
      store.chatGptModels[existing] = nextModel
    } else {
      store.chatGptModels.push(nextModel)
    }

    await writeStore(store)
  })

  await writeQueue
  return nextModel
}

export async function upsertOpenRouterModelSetting(
  model: Omit<StoredOpenRouterModel, "updatedAt">
): Promise<PublicOpenRouterModel> {
  const now = new Date().toISOString()
  const nextModel = { ...model, updatedAt: now }

  writeQueue = writeQueue.then(async () => {
    const store = await readStore()
    const existing = store.openRouterModels.findIndex(
      (candidate) => candidate.id === nextModel.id
    )

    if (existing >= 0) {
      store.openRouterModels[existing] = nextModel
    } else {
      store.openRouterModels.push(nextModel)
    }

    await writeStore(store)
  })

  await writeQueue
  return nextModel
}

export async function upsertOpenRouterKey(key: string) {
  const trimmed = key.trim()

  if (!trimmed) {
    throw new Error("OpenRouter API key is required")
  }

  const now = new Date().toISOString()
  const provider: StoredApiKeyProvider = {
    id: "openrouter",
    type: "openrouter",
    name: "OpenRouter API",
    keyEncrypted: await encryptToken(trimmed),
    keyPrefix: keyPrefix(trimmed),
    createdAt: now,
    updatedAt: now,
    status: "active",
  }

  writeQueue = writeQueue.then(async () => {
    const store = await readStore()
    const existing = store.apiKeyProviders.findIndex(
      (candidate) => candidate.id === provider.id
    )

    if (existing >= 0) {
      provider.createdAt = store.apiKeyProviders[existing].createdAt
      store.apiKeyProviders[existing] = provider
    } else {
      store.apiKeyProviders.push(provider)
    }

    await writeStore(store)
  })

  await writeQueue
  return toPublicApiKeyProvider(provider)
}

export async function getOpenRouterKey() {
  const store = await readStore()
  if (store.apiKeyProviders.length === 0) {
    return null
  }

  const provider = store.apiKeyProviders[0]
  return decryptToken(provider.keyEncrypted)
}

export async function getActiveAccount() {
  const store = await readStore()
  return store.accounts.find((account) => account.status === "active") || null
}

export async function getDecryptedTokens(
  account: StoredAccount
): Promise<OAuthTokens> {
  return {
    accessToken: await decryptToken(account.accessTokenEncrypted),
    refreshToken: await decryptToken(account.refreshTokenEncrypted),
    idToken: await decryptToken(account.idTokenEncrypted),
  }
}

export async function upsertAccountFromTokens(tokens: OAuthTokens) {
  const claims = getClaimsFromIdToken(tokens.idToken)
  const id = generateAccountId(claims.chatgptAccountId, claims.email)
  const now = new Date().toISOString()
  const account: StoredAccount = {
    id,
    chatgptAccountId: claims.chatgptAccountId,
    email: claims.email,
    planType: claims.planType,
    accessTokenEncrypted: await encryptToken(tokens.accessToken),
    refreshTokenEncrypted: await encryptToken(tokens.refreshToken),
    idTokenEncrypted: await encryptToken(tokens.idToken),
    lastRefresh: now,
    createdAt: now,
    status: "active",
    deactivationReason: null,
  }

  writeQueue = writeQueue.then(async () => {
    const store = await readStore()
    const existing = store.accounts.findIndex(
      (candidate) => candidate.id === id || candidate.email === claims.email
    )

    if (existing >= 0) {
      account.createdAt = store.accounts[existing].createdAt
      store.accounts[existing] = account
    } else {
      store.accounts.push(account)
    }

    await writeStore(store)
  })

  await writeQueue
  return toPublicAccount(account)
}

export async function updateAccountTokens(
  account: StoredAccount,
  tokens: OAuthTokens
) {
  const claims = getClaimsFromIdToken(tokens.idToken)
  const updated: StoredAccount = {
    ...account,
    chatgptAccountId: claims.chatgptAccountId,
    email: claims.email,
    planType: claims.planType,
    accessTokenEncrypted: await encryptToken(tokens.accessToken),
    refreshTokenEncrypted: await encryptToken(tokens.refreshToken),
    idTokenEncrypted: await encryptToken(tokens.idToken),
    lastRefresh: new Date().toISOString(),
    status: "active",
    deactivationReason: null,
  }

  writeQueue = writeQueue.then(async () => {
    const store = await readStore()
    const existing = store.accounts.findIndex(
      (candidate) => candidate.id === account.id
    )

    if (existing >= 0) {
      store.accounts[existing] = updated
      await writeStore(store)
    }
  })

  await writeQueue
  return updated
}
