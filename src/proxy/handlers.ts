import { gunzipSync, inflateSync, zstdDecompressSync } from "node:zlib"

import {
  codexModelInfoToManagedModel,
  managedModels,
  ollamaCloudSettingToManagedModel,
  openCodeGoSettingToManagedModel,
  openCodeZenSettingToManagedModel,
  openRouterSettingToManagedModel,
  publicModelId,
  toOpenAIModelList,
} from "./model-registry"
import { toCodexModelCatalog } from "./codex-catalog"
import { getModelsDevOpenCodeMetadata } from "./opencode-zen-capabilities"
import {
  forwardChatCompletions,
  forwardCodexAutoReviewResponses,
  forwardResponses,
} from "./upstreams"
import type { CodexModelInfo, ManagedModel } from "./model-registry"
import type { UsageTokens } from "@/server/usage/types"
import {
  listChatGptModelSettings,
  listOllamaCloudModelSettings,
  listOpenCodeGoModelSettings,
  listOpenCodeZenModelSettings,
  listOpenRouterModelSettings,
  listPoolAccounts,
} from "@/server/accounts/store"
import { selectAccountForRequest } from "@/server/balancer"
import { writeCodexModelCatalog } from "@/server/codex/catalog-file"
import { getAccessTokenForAccount } from "@/server/oauth/service"
import {
  calculateEstimatedCostUsd,
  calculateRealCostUsd,
} from "@/server/usage/pricing"
import { addUsageLog } from "@/server/usage/store"

const MAX_DECOMPRESSED_BODY_BYTES = 32 * 1024 * 1024
const PROVIDER_MODEL_CACHE_TTL_MS = 5 * 60 * 1000

type ResolvedConfiguredModels = {
  enabledModels: Array<ManagedModel>
  catalogModels: Array<ManagedModel>
}

type ProxyTimings = {
  modelResolutionMs: number
  upstreamResponseMs: number
  upstreamFirstByteMs?: number | null
}

let chatGptCodexModelsCache: {
  expiresAt: number
  models: Array<ManagedModel>
} | null = null
let chatGptCodexModelsRequest: Promise<Array<ManagedModel>> | null = null
let openRouterCapabilitiesCache: {
  expiresAt: number
  capabilities: Map<
    string,
    { supportedParameters: Array<string>; inputModalities: Array<string> }
  >
} | null = null
let openRouterCapabilitiesRequest: Promise<
  Map<
    string,
    { supportedParameters: Array<string>; inputModalities: Array<string> }
  >
> | null = null

export function proxyJson(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers":
        "authorization, content-type, content-encoding",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    },
  })
}

function cachedChatGptCodexModels() {
  return chatGptCodexModelsCache?.models || []
}

function shouldRefreshChatGptCodexModels() {
  return (
    !chatGptCodexModelsCache || chatGptCodexModelsCache.expiresAt <= Date.now()
  )
}

async function fetchLiveChatGptCodexModels(): Promise<Array<ManagedModel>> {
  const triedAccountIds = new Set<string>()

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const selection = await selectAccountForRequest(triedAccountIds)

    if (!selection.account) {
      break
    }

    const account = selection.account
    triedAccountIds.add(account.id)

    try {
      const token = await getAccessTokenForAccount(account)

      if (!token) {
        continue
      }

      const headers = new Headers({
        accept: "application/json",
        authorization: `Bearer ${token}`,
      })

      if (account.chatgptAccountId) {
        headers.set("chatgpt-account-id", account.chatgptAccountId)
      }

      const response = await fetch(
        "https://chatgpt.com/backend-api/codex/models?client_version=0.0.0",
        { headers }
      )

      if (!response.ok) {
        continue
      }

      const data = (await response.json()) as { models?: Array<CodexModelInfo> }
      return (data.models || [])
        .filter((model) => typeof model.slug === "string" && model.slug)
        .map(codexModelInfoToManagedModel)
    } catch {
      continue
    }
  }

  return []
}

export async function fetchChatGptCodexModels(): Promise<Array<ManagedModel>> {
  if (!shouldRefreshChatGptCodexModels()) {
    return cachedChatGptCodexModels()
  }

  chatGptCodexModelsRequest ||= fetchLiveChatGptCodexModels().then((models) => {
    chatGptCodexModelsCache = {
      expiresAt:
        Date.now() + (models.length > 0 ? PROVIDER_MODEL_CACHE_TTL_MS : 10_000),
      models,
    }
    chatGptCodexModelsRequest = null
    return models
  })

  return chatGptCodexModelsRequest
}

async function fetchOpenRouterModelCapabilities(): Promise<
  Map<
    string,
    { supportedParameters: Array<string>; inputModalities: Array<string> }
  >
> {
  if (
    openRouterCapabilitiesCache &&
    openRouterCapabilitiesCache.expiresAt > Date.now()
  ) {
    return openRouterCapabilitiesCache.capabilities
  }

  if (openRouterCapabilitiesRequest) {
    return openRouterCapabilitiesRequest
  }

  openRouterCapabilitiesRequest = fetchLiveOpenRouterModelCapabilities().then(
    (capabilities) => {
      openRouterCapabilitiesCache = {
        expiresAt:
          Date.now() +
          (capabilities.size > 0 ? PROVIDER_MODEL_CACHE_TTL_MS : 10_000),
        capabilities,
      }
      openRouterCapabilitiesRequest = null
      return capabilities
    }
  )

  return openRouterCapabilitiesRequest
}

async function fetchLiveOpenRouterModelCapabilities(): Promise<
  Map<
    string,
    { supportedParameters: Array<string>; inputModalities: Array<string> }
  >
> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { accept: "application/json" },
    })

    if (!response.ok) {
      return new Map()
    }

    const data = (await response.json()) as {
      data?: Array<{
        id?: string
        supported_parameters?: Array<string>
        architecture?: { input_modalities?: Array<string> }
      }>
    }

    return new Map(
      (data.data || [])
        .filter((model) => typeof model.id === "string" && model.id)
        .map((model) => [
          `openrouter/${model.id}`,
          {
            supportedParameters: model.supported_parameters || [],
            inputModalities: model.architecture?.input_modalities || ["text"],
          },
        ])
    )
  } catch {
    return new Map<
      string,
      { supportedParameters: Array<string>; inputModalities: Array<string> }
    >()
  }
}

function contentEncodings(request: Request) {
  return (request.headers.get("content-encoding") || "")
    .split(",")
    .map((encoding) => encoding.trim().toLowerCase())
    .filter(Boolean)
}

function decodeRequestBody(bytes: Buffer, encodings: Array<string>) {
  let body = bytes

  for (const encoding of [...encodings].reverse()) {
    if (encoding === "identity") {
      continue
    }

    if (encoding === "zstd") {
      body = zstdDecompressSync(body)
    } else if (encoding === "gzip" || encoding === "x-gzip") {
      body = gunzipSync(body)
    } else if (encoding === "deflate") {
      body = inflateSync(body)
    } else {
      throw new Error(`Unsupported Content-Encoding: ${encoding}`)
    }

    if (body.byteLength > MAX_DECOMPRESSED_BODY_BYTES) {
      throw new Error("Request body exceeds maximum decompressed size")
    }
  }

  return body
}

async function readJson(request: Request) {
  try {
    const encodings = contentEncodings(request)

    if (encodings.length === 0) {
      return (await request.json()) as Record<string, unknown>
    }

    const compressed = Buffer.from(await request.arrayBuffer())
    const decoded = decodeRequestBody(compressed, encodings)
    return JSON.parse(decoded.toString("utf8")) as Record<string, unknown>
  } catch {
    return null
  }
}

function getRequestedModel(body: Record<string, unknown> | null) {
  return typeof body?.model === "string" ? body.model : null
}

function getServiceTier(
  body: Record<string, unknown> | null,
  payload: unknown
) {
  const data = getRecord(payload)

  return (
    (typeof body?.service_tier === "string" && body.service_tier) ||
    (typeof data?.service_tier === "string" && data.service_tier) ||
    null
  )
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function getRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null
}

function extractUsageTokens(payload: unknown): UsageTokens {
  const root = getRecord(payload)
  const nestedResponse = getRecord(root?.response)
  const data = getRecord(nestedResponse?.usage) ? nestedResponse : root
  const usage = getRecord(data?.usage)
  const inputDetails = getRecord(usage?.input_tokens_details)
  const outputDetails = getRecord(usage?.output_tokens_details)
  const promptDetails = getRecord(usage?.prompt_tokens_details)
  const completionDetails = getRecord(usage?.completion_tokens_details)
  const inputTokens =
    getNumber(usage?.input_tokens) || getNumber(usage?.prompt_tokens)
  const outputTokens =
    getNumber(usage?.output_tokens) || getNumber(usage?.completion_tokens)

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens:
      getNumber(inputDetails?.cached_tokens) ||
      getNumber(promptDetails?.cached_tokens),
    reasoningTokens:
      getNumber(outputDetails?.reasoning_tokens) ||
      getNumber(completionDetails?.reasoning_tokens),
  }
}

function estimateTokenCount(value: unknown) {
  if (value === null || value === undefined) {
    return 0
  }

  const text = typeof value === "string" ? value : JSON.stringify(value)
  return Math.ceil(text.length / 4)
}

function extractText(value: unknown): string {
  if (typeof value === "string") {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(extractText).filter(Boolean).join("\n")
  }

  const record = getRecord(value)

  if (!record) {
    return ""
  }

  return [
    record.text,
    record.content,
    record.output_text,
    record.arguments,
    record.summary,
    record.output,
  ]
    .map(extractText)
    .filter(Boolean)
    .join("\n")
}

function estimateUsageTokens(
  body: Record<string, unknown>,
  payload: unknown
): UsageTokens {
  return {
    inputTokens: estimateTokenCount(body.input ?? body.messages ?? body),
    outputTokens: estimateTokenCount(extractText(payload)),
    cachedInputTokens: 0,
    reasoningTokens: 0,
  }
}

function withEstimatedTokens(
  tokens: UsageTokens,
  body: Record<string, unknown>,
  payload: unknown
) {
  if (
    tokens.inputTokens > 0 ||
    tokens.outputTokens > 0 ||
    tokens.cachedInputTokens > 0 ||
    tokens.reasoningTokens > 0
  ) {
    return tokens
  }

  return estimateUsageTokens(body, payload)
}

function parseSsePayload(text: string) {
  const events = text
    .split("\n")
    .map((line) => line.trimStart())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((line) => line && line !== "[DONE]")

  for (const event of [...events].reverse()) {
    try {
      const parsed = JSON.parse(event) as unknown
      const record = getRecord(parsed)
      const response = getRecord(record?.response)

      if (
        getRecord(response?.usage) ||
        getRecord(record?.usage) ||
        getRecord(response?.error) ||
        getRecord(record?.error)
      ) {
        return response || parsed
      }

      if (
        (record?.type === "response.completed" ||
          record?.type === "response.failed") &&
        response
      ) {
        return response
      }
    } catch {
      // Keep scanning older events.
    }
  }

  return events.join("\n")
}

function isSsePayload(contentType: string, text: string) {
  const trimmed = text.trimStart()

  return (
    contentType.includes("text/event-stream") ||
    trimmed.startsWith("event:") ||
    trimmed.startsWith("data:")
  )
}

function extractUpstreamCostUsd(payload: unknown) {
  const data = getRecord(payload)
  const usage = getRecord(data?.usage)
  return getNumber(usage?.cost) || getNumber(data?.cost)
}

function extractError(payload: unknown, statusCode: number) {
  const data = getRecord(payload)
  const error = getRecord(data?.error)
  const code =
    (typeof error?.code === "string" && error.code) ||
    (typeof error?.type === "string" && error.type) ||
    (statusCode >= 400 ? `http_${statusCode}` : null)
  const message =
    (typeof error?.message === "string" && error.message) ||
    (typeof data?.message === "string" && data.message) ||
    null

  return { code, message }
}

async function readUsagePayload(response: Response, contentType: string) {
  const reader = response.body?.getReader()

  if (!reader) {
    return { payload: null, upstreamFirstByteMs: null }
  }

  const decoder = new TextDecoder()
  const startedAt = performance.now()
  let text = ""
  let upstreamFirstByteMs: number | null = null

  try {
    for (;;) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      if (value.byteLength > 0 && upstreamFirstByteMs === null) {
        upstreamFirstByteMs = Math.max(
          0,
          Math.round(performance.now() - startedAt)
        )
      }

      text += decoder.decode(value, { stream: true })
    }

    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }

  if (contentType.includes("application/json")) {
    try {
      return {
        payload: text ? JSON.parse(text) : null,
        upstreamFirstByteMs,
      }
    } catch {
      return { payload: null, upstreamFirstByteMs }
    }
  }

  return {
    payload: isSsePayload(contentType, text) ? parseSsePayload(text) : text,
    upstreamFirstByteMs,
  }
}

async function recordUsage({
  requestStartedAtMs,
  requestStartedAtEpochMs,
  model,
  kind,
  body,
  response,
  payload,
  timings,
}: {
  requestStartedAtMs: number
  requestStartedAtEpochMs: number
  model: ManagedModel
  kind: "chat" | "responses"
  body: Record<string, unknown>
  response: Response
  payload: unknown
  timings: ProxyTimings
}) {
  const tokens = withEstimatedTokens(extractUsageTokens(payload), body, payload)
  const upstreamCostUsd = extractUpstreamCostUsd(payload)
  const serviceTier = getServiceTier(body, payload)
  const estimatedCostUsd = await calculateEstimatedCostUsd(
    model.provider,
    model.upstreamModel,
    tokens,
    upstreamCostUsd,
    serviceTier
  )
  const { code, message } = extractError(payload, response.status)
  const status = response.status >= 400 || code ? "error" : "success"

  await addUsageLog({
    id: crypto.randomUUID(),
    requestedAt: new Date(requestStartedAtEpochMs).toISOString(),
    provider: model.provider,
    model: model.id,
    upstreamModel: model.upstreamModel,
    route: kind,
    status,
    statusCode: response.status,
    errorCode: status === "error" ? code : null,
    errorMessage: status === "error" ? message : null,
    serviceTier,
    estimatedCostUsd,
    realCostUsd: calculateRealCostUsd(model.provider, estimatedCostUsd),
    latencyMs: Math.max(0, Math.round(performance.now() - requestStartedAtMs)),
    modelResolutionMs: timings.modelResolutionMs,
    upstreamResponseMs: timings.upstreamResponseMs,
    upstreamFirstByteMs: timings.upstreamFirstByteMs ?? null,
    ...tokens,
  })
}

function logResponseUsage(
  requestStartedAtMs: number,
  requestStartedAtEpochMs: number,
  model: ManagedModel,
  kind: "chat" | "responses",
  body: Record<string, unknown>,
  response: Response,
  timings: ProxyTimings
) {
  const contentType = response.headers.get("content-type") || ""
  const loggingResponse = response.clone()

  void (async () => {
    let payload: unknown = null
    let upstreamFirstByteMs: number | null = null

    try {
      const read = await readUsagePayload(loggingResponse, contentType)
      payload = read.payload
      upstreamFirstByteMs = read.upstreamFirstByteMs
    } catch {
      payload = null
    }

    const usageTimings = {
      ...timings,
      upstreamFirstByteMs:
        upstreamFirstByteMs === null
          ? null
          : timings.upstreamResponseMs + upstreamFirstByteMs,
    }

    try {
      await recordUsage({
        requestStartedAtMs,
        requestStartedAtEpochMs,
        model,
        kind,
        body,
        response: loggingResponse,
        payload,
        timings: usageTimings,
      })
    } catch {
      // Usage logging should not break the proxy response.
    }
  })()

  return response
}

function upstreamExceptionResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "fetch failed"

  return proxyJson(
    {
      error: {
        message: `Upstream request failed: ${message}`,
        type: "upstream_fetch_failed",
      },
    },
    502
  )
}

function hiddenChatGptModelOverride(model: ManagedModel): ManagedModel {
  return {
    ...model,
    enabled: false,
    codexModelInfo: {
      ...(model.codexModelInfo || {
        slug: model.id,
        display_name: model.displayName,
      }),
      visibility: "hide",
    },
  }
}

function findManagedModel(models: Array<ManagedModel>, modelId: string) {
  return models.find(
    (candidate) =>
      candidate.id === modelId || publicModelId(candidate) === modelId
  )
}

function hasOpenAICredentials() {
  return Boolean(process.env.CMM_OPENAI_KEYS || process.env.OPENAI_API_KEY)
}

function isOpenAIModelId(modelId: string) {
  return (
    !modelId.includes("/") &&
    !modelId.startsWith("openrouter-") &&
    !modelId.startsWith("opencode-") &&
    !modelId.startsWith("ollama-")
  )
}

function fallbackChatGptModel(
  modelId: string,
  displayName = modelId
): ManagedModel {
  return {
    id: modelId,
    displayName,
    provider: "openai-pool",
    upstreamModel: modelId,
    enabled: true,
    supportsResponses: true,
    supportsChatCompletions: false,
    supportsReasoning: true,
    reasoningCapability: { kind: "effort", levels: ["low", "medium", "high"] },
    contextWindow: 0,
    outputLimit: 0,
    inputModalities: ["text"],
  }
}

async function resolveStoredModels({
  includeLiveOpenAI,
  includeProviderCapabilities,
}: {
  includeLiveOpenAI: boolean
  includeProviderCapabilities: boolean
}): Promise<ResolvedConfiguredModels> {
  const [
    settings,
    openCodeZenSettings,
    openCodeGoSettings,
    ollamaCloudSettings,
    chatGptSettings,
    liveOpenAIModels,
  ] = await Promise.all([
    listOpenRouterModelSettings(),
    listOpenCodeZenModelSettings(),
    listOpenCodeGoModelSettings(),
    listOllamaCloudModelSettings(),
    listChatGptModelSettings(),
    includeLiveOpenAI
      ? fetchChatGptCodexModels()
      : Promise.resolve(cachedChatGptCodexModels()),
  ])
  const chatGptSettingsById = new Map(
    chatGptSettings.map((model) => [model.id, model])
  )
  const enabledLiveOpenAIModels = liveOpenAIModels.filter(
    (model) => chatGptSettingsById.get(model.id)?.enabled ?? model.enabled
  )
  const hiddenLiveOpenAIModels = liveOpenAIModels
    .filter((model) => chatGptSettingsById.get(model.id)?.enabled === false)
    .map(hiddenChatGptModelOverride)
  const openRouterCapabilities =
    includeProviderCapabilities &&
    settings.some(
      (model) => model.providerName || model.id.startsWith("openrouter/")
    )
      ? await fetchOpenRouterModelCapabilities()
      : new Map<
          string,
          { supportedParameters: Array<string>; inputModalities: Array<string> }
        >()
  const openCodeZenMetadataById =
    includeProviderCapabilities && openCodeZenSettings.length > 0
      ? await getModelsDevOpenCodeMetadata()
      : new Map()
  const openCodeGoMetadataById =
    includeProviderCapabilities && openCodeGoSettings.length > 0
      ? await getModelsDevOpenCodeMetadata()
      : new Map()
  const hasOpenRouterSettings = settings.length > 0
  const settingsById = new Map(settings.map((model) => [model.id, model]))
  const staticModels = managedModels.filter((model) => {
    if (model.provider === "openai-pool") {
      const setting = chatGptSettingsById.get(model.id)

      if (setting) {
        return setting.enabled
      }

      if (liveOpenAIModels.length > 0) {
        return false
      }
    }

    const setting = settingsById.get(model.id)

    if (setting) {
      return setting.enabled
    }

    if (model.provider === "openrouter" && hasOpenRouterSettings) {
      return false
    }

    return model.enabled
  })
  const configuredOpenRouterModels = settings
    .filter(
      (model) =>
        model.enabled &&
        !managedModels.some((managedModel) => managedModel.id === model.id)
    )
    .map((model) => {
      const capability = openRouterCapabilities.get(model.id)
      const supportedParameters =
        capability?.supportedParameters || model.supportedParameters || []
      return openRouterSettingToManagedModel({
        ...model,
        supportedParameters,
        inputModalities: capability?.inputModalities ||
          model.inputModalities || ["text"],
      })
    })
  const configuredOpenCodeZenModels = openCodeZenSettings
    .filter((model) => model.enabled)
    .map((model) =>
      openCodeZenSettingToManagedModel(
        model,
        openCodeZenMetadataById.get(model.upstreamModel)
      )
    )
  const configuredOpenCodeGoModels = openCodeGoSettings
    .filter((model) => model.enabled)
    .map((model) =>
      openCodeGoSettingToManagedModel(
        model,
        openCodeGoMetadataById.get(model.upstreamModel)
      )
    )
  const configuredOllamaCloudModels = ollamaCloudSettings
    .filter((model) => model.enabled)
    .map(ollamaCloudSettingToManagedModel)

  return {
    enabledModels: [
      ...enabledLiveOpenAIModels,
      ...staticModels,
      ...configuredOpenRouterModels,
      ...configuredOllamaCloudModels,
      ...configuredOpenCodeZenModels,
      ...configuredOpenCodeGoModels,
    ],
    catalogModels: [
      ...enabledLiveOpenAIModels,
      ...hiddenLiveOpenAIModels,
      ...staticModels,
      ...configuredOpenRouterModels,
      ...configuredOllamaCloudModels,
      ...configuredOpenCodeZenModels,
      ...configuredOpenCodeGoModels,
    ],
  }
}

async function resolveConfiguredModels() {
  return resolveStoredModels({
    includeLiveOpenAI: true,
    includeProviderCapabilities: true,
  })
}

async function resolveRequestModel(modelId: string) {
  const localModels = await resolveStoredModels({
    includeLiveOpenAI: false,
    includeProviderCapabilities: false,
  })
  const localModel = findManagedModel(localModels.enabledModels, modelId)

  if (localModel) {
    return localModel
  }

  const chatGptSettings = await listChatGptModelSettings()
  const chatGptSetting = chatGptSettings.find((model) => model.id === modelId)

  if (chatGptSetting?.enabled === false) {
    return null
  }

  if (!isOpenAIModelId(modelId)) {
    return null
  }

  const poolAccounts = await listPoolAccounts()

  if (poolAccounts.length === 0 && !hasOpenAICredentials()) {
    return null
  }

  if (shouldRefreshChatGptCodexModels()) {
    void fetchChatGptCodexModels().catch(() => undefined)
  }

  return fallbackChatGptModel(modelId, chatGptSetting?.displayName)
}

export async function getEnabledModels() {
  return (await resolveConfiguredModels()).enabledModels
}

export async function getCodexCatalogModels() {
  return (await resolveConfiguredModels()).catalogModels
}

export async function getHealth() {
  const models = await resolveConfiguredModels()
  await writeCodexModelCatalog(models.catalogModels)
  return proxyJson({ ok: true, models: models.enabledModels.length })
}

export async function getOpenAIModels() {
  const models = await resolveConfiguredModels()
  await writeCodexModelCatalog(models.catalogModels)
  return proxyJson(toOpenAIModelList(models.enabledModels))
}

export async function getCodexModels() {
  const models = await getCodexCatalogModels()
  await writeCodexModelCatalog(models)
  return proxyJson(toCodexModelCatalog(models))
}

export async function getManagedModels() {
  const models = await resolveConfiguredModels()
  await writeCodexModelCatalog(models.catalogModels)
  return proxyJson({ models: models.enabledModels })
}

export function optionsResponse() {
  return proxyJson({ ok: true })
}

export async function routeProxyRequest(
  request: Request,
  kind: "chat" | "responses"
) {
  const codexControlRequest = kind === "responses" ? request.clone() : null
  const requestStartedAtMs = performance.now()
  const requestStartedAtEpochMs = Date.now()
  const body = await readJson(request)
  const modelId = getRequestedModel(body)

  if (!body || !modelId) {
    return proxyJson(
      {
        error: {
          message:
            "Request body must be JSON and include a string model field.",
          type: "invalid_request",
        },
      },
      400
    )
  }

  if (kind === "responses" && modelId === "codex-auto-review") {
    return forwardCodexAutoReviewResponses(codexControlRequest!, body)
  }

  const modelResolutionStartedAtMs = performance.now()
  const model = await resolveRequestModel(modelId)
  const modelResolutionMs = Math.max(
    0,
    Math.round(performance.now() - modelResolutionStartedAtMs)
  )

  if (!model) {
    return proxyJson(
      {
        error: {
          message: `Model ${modelId} is not enabled in Codex Model Manager.`,
          type: "model_not_found",
        },
      },
      404
    )
  }

  if (kind === "chat") {
    let response: Response
    const upstreamStartedAtMs = performance.now()

    try {
      response = await forwardChatCompletions({ request, model, body })
    } catch (error) {
      response = upstreamExceptionResponse(error)
    }

    const upstreamResponseMs = Math.max(
      0,
      Math.round(performance.now() - upstreamStartedAtMs)
    )

    return logResponseUsage(
      requestStartedAtMs,
      requestStartedAtEpochMs,
      model,
      kind,
      body,
      response,
      { modelResolutionMs, upstreamResponseMs }
    )
  }

  let response: Response
  const upstreamStartedAtMs = performance.now()

  try {
    response = await forwardResponses({ request, model, body })
  } catch (error) {
    response = upstreamExceptionResponse(error)
  }

  const upstreamResponseMs = Math.max(
    0,
    Math.round(performance.now() - upstreamStartedAtMs)
  )

  return logResponseUsage(
    requestStartedAtMs,
    requestStartedAtEpochMs,
    model,
    kind,
    body,
    response,
    { modelResolutionMs, upstreamResponseMs }
  )
}
