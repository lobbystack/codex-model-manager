import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import type {
  OAuthTokens,
  PublicAccount,
  PublicApiKeyProvider,
  PublicChatGptModel,
  PublicOllamaCloudModel,
  PublicOpenCodeGoModel,
  PublicOpenCodeZenModel,
  PublicOpenRouterModel,
  StoredAccount,
  StoredApiKeyProvider,
  StoredChatGptModel,
  StoredOllamaCloudModel,
  StoredOpenCodeGoModel,
  StoredOpenCodeZenModel,
  StoredOpenRouterModel,
} from "./types"

type StoreFile = {
  accounts: Array<StoredAccount>
  apiKeyProviders: Array<StoredApiKeyProvider>
  openRouterModels: Array<StoredOpenRouterModel>
  openCodeZenModels: Array<StoredOpenCodeZenModel>
  openCodeGoModels: Array<StoredOpenCodeGoModel>
  ollamaCloudModels: Array<StoredOllamaCloudModel>
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
      openCodeZenModels: Array.isArray(parsed.openCodeZenModels)
        ? parsed.openCodeZenModels
        : [],
      openCodeGoModels: Array.isArray(parsed.openCodeGoModels)
        ? parsed.openCodeGoModels
        : [],
      ollamaCloudModels: Array.isArray(parsed.ollamaCloudModels)
        ? parsed.ollamaCloudModels
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
      openCodeZenModels: [],
      openCodeGoModels: [],
      ollamaCloudModels: [],
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

export async function listOpenCodeZenModelSettings(): Promise<
  Array<PublicOpenCodeZenModel>
> {
  const store = await readStore()
  return store.openCodeZenModels
}

export async function listOpenCodeGoModelSettings(): Promise<
  Array<PublicOpenCodeGoModel>
> {
  const store = await readStore()
  return store.openCodeGoModels
}

export async function listOllamaCloudModelSettings(): Promise<
  Array<PublicOllamaCloudModel>
> {
  const store = await readStore()
  return store.ollamaCloudModels
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

export async function upsertOpenCodeZenModelSetting(
  model: Omit<StoredOpenCodeZenModel, "updatedAt">
): Promise<PublicOpenCodeZenModel> {
  const now = new Date().toISOString()
  const nextModel = { ...model, updatedAt: now }

  writeQueue = writeQueue.then(async () => {
    const store = await readStore()
    const existing = store.openCodeZenModels.findIndex(
      (candidate) => candidate.id === nextModel.id
    )

    if (existing >= 0) {
      store.openCodeZenModels[existing] = nextModel
    } else {
      store.openCodeZenModels.push(nextModel)
    }

    await writeStore(store)
  })

  await writeQueue
  return nextModel
}

export async function upsertOpenCodeGoModelSetting(
  model: Omit<StoredOpenCodeGoModel, "updatedAt">
): Promise<PublicOpenCodeGoModel> {
  const now = new Date().toISOString()
  const nextModel = { ...model, updatedAt: now }

  writeQueue = writeQueue.then(async () => {
    const store = await readStore()
    const existing = store.openCodeGoModels.findIndex(
      (candidate) => candidate.id === nextModel.id
    )

    if (existing >= 0) {
      store.openCodeGoModels[existing] = nextModel
    } else {
      store.openCodeGoModels.push(nextModel)
    }

    await writeStore(store)
  })

  await writeQueue
  return nextModel
}

export async function upsertOllamaCloudModelSetting(
  model: Omit<StoredOllamaCloudModel, "updatedAt">
): Promise<PublicOllamaCloudModel> {
  const now = new Date().toISOString()
  const nextModel = { ...model, updatedAt: now }

  writeQueue = writeQueue.then(async () => {
    const store = await readStore()
    const existing = store.ollamaCloudModels.findIndex(
      (candidate) => candidate.id === nextModel.id
    )

    if (existing >= 0) {
      store.ollamaCloudModels[existing] = nextModel
    } else {
      store.ollamaCloudModels.push(nextModel)
    }

    await writeStore(store)
  })

  await writeQueue
  return nextModel
}

async function upsertApiKeyProvider(
  provider: StoredApiKeyProvider
): Promise<PublicApiKeyProvider> {
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

  return upsertApiKeyProvider(provider)
}

export async function getOpenRouterKey() {
  const store = await readStore()
  const provider = store.apiKeyProviders.find(
    (candidate) => candidate.id === "openrouter"
  )

  if (!provider) {
    return null
  }

  return decryptToken(provider.keyEncrypted)
}

export async function upsertOpenCodeZenKey(key: string) {
  const trimmed = key.trim()

  if (!trimmed) {
    throw new Error("OpenCode Zen API key is required")
  }

  const now = new Date().toISOString()
  const provider: StoredApiKeyProvider = {
    id: "opencode-zen",
    type: "opencode-zen",
    name: "OpenCode Zen",
    keyEncrypted: await encryptToken(trimmed),
    keyPrefix: keyPrefix(trimmed),
    createdAt: now,
    updatedAt: now,
    status: "active",
  }

  return upsertApiKeyProvider(provider)
}

export async function getOpenCodeZenKey() {
  const store = await readStore()
  const provider = store.apiKeyProviders.find(
    (candidate) => candidate.id === "opencode-zen"
  )

  if (!provider) {
    return null
  }

  return decryptToken(provider.keyEncrypted)
}

export async function upsertOpenCodeGoKey(key: string) {
  const trimmed = key.trim()

  if (!trimmed) {
    throw new Error("OpenCode Go API key is required")
  }

  const now = new Date().toISOString()
  const provider: StoredApiKeyProvider = {
    id: "opencode-go",
    type: "opencode-go",
    name: "OpenCode Go",
    keyEncrypted: await encryptToken(trimmed),
    keyPrefix: keyPrefix(trimmed),
    createdAt: now,
    updatedAt: now,
    status: "active",
  }

  return upsertApiKeyProvider(provider)
}

export async function getOpenCodeGoKey() {
  const store = await readStore()
  const provider = store.apiKeyProviders.find(
    (candidate) => candidate.id === "opencode-go"
  )

  if (!provider) {
    return null
  }

  return decryptToken(provider.keyEncrypted)
}

export async function resolveOpenCodeGoKey() {
  return (await getOpenCodeGoKey()) || (await getOpenCodeZenKey())
}

export async function upsertOllamaCloudKey(key: string) {
  const trimmed = key.trim()

  if (!trimmed) {
    throw new Error("Ollama Cloud API key is required")
  }

  const now = new Date().toISOString()
  const provider: StoredApiKeyProvider = {
    id: "ollama-cloud",
    type: "ollama-cloud",
    name: "Ollama Cloud",
    keyEncrypted: await encryptToken(trimmed),
    keyPrefix: keyPrefix(trimmed),
    createdAt: now,
    updatedAt: now,
    status: "active",
  }

  return upsertApiKeyProvider(provider)
}

export async function getOllamaCloudKey() {
  const store = await readStore()
  const provider = store.apiKeyProviders.find(
    (candidate) => candidate.id === "ollama-cloud"
  )

  if (!provider) {
    return null
  }

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
