import { createFileRoute } from "@tanstack/react-router"

import type { ZenModelMetadata } from "@/proxy/opencode-zen-capabilities"
import {
  clampZenInputModalities,
  getModelsDevOpenCodeMetadata,
  mergeZenModelCapabilities,
  resolveZenInputModalities,
} from "@/proxy/opencode-zen-capabilities"
import { getEnabledModels } from "@/proxy/handlers"
import {
  inferOpenCodeGoReasoningCapability,
  openCodeGoModelFamily,
} from "@/proxy/model-registry"
import { apiJson, apiOptions, readJson } from "@/server/api/json"
import {
  listOpenCodeGoModelSettings,
  resolveOpenCodeGoKey,
  upsertOpenCodeGoKey,
  upsertOpenCodeGoModelSetting,
} from "@/server/accounts/store"
import { writeCodexModelCatalog } from "@/server/codex/catalog-file"

const PROVIDER_MODELS_CACHE_TTL_MS = 5 * 60 * 1000

let openCodeGoModelsCache:
  | { expiresAt: number; models: Array<ZenModelMetadata> }
  | undefined

const defaultEnabledModelIds = new Set([
  "opencode-go/kimi-k2.6",
  "opencode-go/glm-5.1",
  "opencode-go/deepseek-v4-flash",
])

const contextWindows: Record<string, number | undefined> = {
  "glm-5.1": 128000,
  "glm-5": 128000,
  "kimi-k2.7-code": 256000,
  "kimi-k2.7": 256000,
  "kimi-k2.6": 256000,
  "kimi-k2.5": 256000,
  "deepseek-v4-pro": 128000,
  "deepseek-v4-flash": 128000,
  "mimo-v2.5-pro": 128000,
  "mimo-v2.5": 128000,
  "mimo-v2-pro": 128000,
  "mimo-v2-omni": 128000,
  "minimax-m3": 200000,
  "minimax-m2.7": 200000,
  "minimax-m2.5": 200000,
  "qwen3.7-max": 256000,
  "qwen3.7-plus": 256000,
  "qwen3.6-plus": 256000,
  "qwen3.5-plus": 256000,
}

function titleCase(value: string) {
  return value
    .split(/[.-]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ")
}

function providerNameForModel(id: string) {
  if (id.startsWith("kimi-")) {
    return "Moonshot AI"
  }

  if (id.startsWith("qwen")) {
    return "Qwen"
  }

  if (id.startsWith("minimax-")) {
    return "MiniMax"
  }

  if (id.startsWith("glm-")) {
    return "Zhipu AI"
  }

  if (id.startsWith("deepseek-")) {
    return "DeepSeek"
  }

  if (id.startsWith("mimo-")) {
    return "Xiaomi"
  }

  return "OpenCode Go"
}

function displayNameForModel(id: string) {
  return titleCase(id)
    .replace(/^Glm\b/, "GLM")
    .replace(/K2\.7 Code/, "K2.7 Code")
}

async function resolveProviderKey() {
  return (
    (await resolveOpenCodeGoKey()) ||
    process.env.OPENCODE_GO_API_KEY ||
    process.env.OPENCODE_ZEN_API_KEY
  )
}

async function fetchOpenCodeGoModels() {
  const key = await resolveProviderKey()
  const headers = new Headers({ accept: "application/json" })

  if (key) {
    headers.set("authorization", `Bearer ${key}`)
  }

  const response = await fetch("https://opencode.ai/zen/go/v1/models", {
    headers,
  })

  if (!response.ok) {
    throw response
  }

  const data = (await response.json()) as { data?: Array<ZenModelMetadata> }
  return data.data || []
}

async function getCachedOpenCodeGoModels() {
  if (openCodeGoModelsCache && openCodeGoModelsCache.expiresAt > Date.now()) {
    return openCodeGoModelsCache.models
  }

  const models = await fetchOpenCodeGoModels()

  openCodeGoModelsCache = {
    expiresAt: Date.now() + PROVIDER_MODELS_CACHE_TTL_MS,
    models,
  }

  return models
}

function toManagedGoModel({
  model,
  metadataById,
  setting,
  hasSettings,
  hasProviderKey,
}: {
  model: ZenModelMetadata
  metadataById: Map<string, ZenModelMetadata>
  setting?: {
    displayName: string
    providerName: string
    enabled: boolean
    supportsReasoning?: boolean
    supportedParameters?: Array<string>
    contextWindow: number
    outputLimit: number
    inputModalities?: Array<string>
  }
  hasSettings: boolean
  hasProviderKey: boolean
}) {
  const id = `opencode-go/${model.id}`
  const modelsDevMetadata = metadataById.get(model.id)
  const capabilities = mergeZenModelCapabilities(model, modelsDevMetadata)
  const reasoningCapability = inferOpenCodeGoReasoningCapability(id)
  const family = openCodeGoModelFamily(id)

  return {
    id,
    displayName:
      setting?.displayName ||
      capabilities.displayName ||
      displayNameForModel(model.id),
    provider: "opencode-go",
    providerName: setting?.providerName || providerNameForModel(model.id),
    upstreamModel: model.id,
    enabled:
      setting?.enabled ??
      (!hasSettings && hasProviderKey && defaultEnabledModelIds.has(id)),
    supportsResponses: true,
    supportsChatCompletions: family === "chat",
    supportsReasoning:
      setting?.supportsReasoning ?? reasoningCapability.kind !== "none",
    supportedParameters: setting?.supportedParameters || [],
    contextWindow:
      setting?.contextWindow ||
      capabilities.contextWindow ||
      contextWindows[model.id] ||
      0,
    outputLimit: setting?.outputLimit || capabilities.outputLimit || 65536,
    inputModalities: resolveZenInputModalities({
      modelId: id,
      metadata: {
        ...modelsDevMetadata,
        ...model,
        architecture: model.architecture || modelsDevMetadata?.architecture,
        modalities: model.modalities || modelsDevMetadata?.modalities,
      },
      storedModalities: setting?.inputModalities,
    }),
  }
}

async function listOpenCodeGoModels() {
  let upstreamModels: Array<ZenModelMetadata>

  try {
    upstreamModels = await getCachedOpenCodeGoModels()
  } catch (error) {
    return apiJson(
      { error: { message: "Unable to load OpenCode Go models." } },
      error instanceof Response ? error.status : 500
    )
  }

  const [settings, metadataById] = await Promise.all([
    listOpenCodeGoModelSettings(),
    getModelsDevOpenCodeMetadata(),
  ])
  const hasSettings = settings.length > 0
  const hasProviderKey = Boolean(await resolveProviderKey())

  if (hasProviderKey && !hasSettings) {
    await persistDefaultOpenCodeGoModels()
    await writeCodexModelCatalog(await getEnabledModels())
  }

  const nextSettings = hasProviderKey && !hasSettings
    ? await listOpenCodeGoModelSettings()
    : settings
  const settingsById = new Map(nextSettings.map((model) => [model.id, model]))
  const models = upstreamModels.map((model) =>
    toManagedGoModel({
      model,
      metadataById,
      setting: settingsById.get(`opencode-go/${model.id}`),
      hasSettings: nextSettings.length > 0,
      hasProviderKey,
    })
  )

  return apiJson({
    models,
  })
}

async function persistDefaultOpenCodeGoModels() {
  const [upstreamModels, metadataById] = await Promise.all([
    getCachedOpenCodeGoModels(),
    getModelsDevOpenCodeMetadata(),
  ])
  const settings = await listOpenCodeGoModelSettings()

  if (settings.length > 0) {
    return
  }

  for (const model of upstreamModels) {
    const id = `opencode-go/${model.id}`

    if (!defaultEnabledModelIds.has(id)) {
      continue
    }

    const managedModel = toManagedGoModel({
      model,
      metadataById,
      hasSettings: false,
      hasProviderKey: true,
    })
    const reasoningCapability = inferOpenCodeGoReasoningCapability(id)

    await upsertOpenCodeGoModelSetting({
      id,
      displayName: managedModel.displayName,
      providerName: providerNameForModel(model.id),
      upstreamModel: model.id,
      enabled: true,
      supportsReasoning: reasoningCapability.kind !== "none",
      supportedParameters: [],
      contextWindow: managedModel.contextWindow,
      outputLimit: managedModel.outputLimit,
      inputModalities: managedModel.inputModalities,
    })
  }
}

async function updateOpenCodeGoModel(request: Request) {
  const body = await readJson(request)

  if (typeof body.id !== "string" || !body.id.startsWith("opencode-go/")) {
    return apiJson(
      { error: { message: "OpenCode Go model id is required." } },
      400
    )
  }

  if (typeof body.enabled !== "boolean") {
    return apiJson({ error: { message: "Enabled must be a boolean." } }, 400)
  }

  const upstreamModel =
    typeof body.upstreamModel === "string"
      ? body.upstreamModel
      : body.id.replace(/^opencode-go\//, "")
  const metadataById = await getModelsDevOpenCodeMetadata()
  const modelsDevMetadata = metadataById.get(upstreamModel)
  const allowedInputModalities = resolveZenInputModalities({
    modelId: body.id,
    metadata: modelsDevMetadata,
  })
  const requestedInputModalities = Array.isArray(body.inputModalities)
    ? body.inputModalities.filter((modality) => typeof modality === "string")
    : undefined
  const inputModalities = clampZenInputModalities(
    requestedInputModalities,
    allowedInputModalities
  )
  const capabilities = mergeZenModelCapabilities(
    { id: upstreamModel },
    modelsDevMetadata
  )
  const displayName =
    typeof body.displayName === "string" && body.displayName.trim()
      ? body.displayName.trim()
      : capabilities.displayName || displayNameForModel(upstreamModel)
  const providerName =
    typeof body.providerName === "string" && body.providerName.trim()
      ? body.providerName.trim()
      : providerNameForModel(upstreamModel)
  const contextWindow =
    typeof body.contextWindow === "number"
      ? body.contextWindow
      : capabilities.contextWindow || contextWindows[upstreamModel] || 0
  const outputLimit =
    typeof body.outputLimit === "number"
      ? body.outputLimit
      : capabilities.outputLimit || 65536
  const supportedParameters = Array.isArray(body.supportedParameters)
    ? body.supportedParameters.filter(
        (parameter) => typeof parameter === "string"
      )
    : []
  const supportsReasoning =
    typeof body.supportsReasoning === "boolean"
      ? body.supportsReasoning
      : inferOpenCodeGoReasoningCapability(body.id).kind !== "none"

  const model = await upsertOpenCodeGoModelSetting({
    id: body.id,
    displayName,
    providerName,
    upstreamModel,
    enabled: body.enabled,
    supportsReasoning,
    supportedParameters,
    contextWindow,
    outputLimit,
    inputModalities,
  })

  await writeCodexModelCatalog(await getEnabledModels())

  return apiJson({ model })
}

export const Route = createFileRoute("/api/providers/opencode-go")({
  server: {
    handlers: {
      GET: () => listOpenCodeGoModels(),
      PATCH: ({ request }) => updateOpenCodeGoModel(request),
      POST: async ({ request }) => {
        const body = await readJson(request)

        if (typeof body.apiKey !== "string" || !body.apiKey.trim()) {
          return apiJson(
            { error: { message: "OpenCode Go API key is required." } },
            400
          )
        }

        const provider = await upsertOpenCodeGoKey(body.apiKey)
        openCodeGoModelsCache = undefined
        await persistDefaultOpenCodeGoModels()

        return apiJson({ provider })
      },
      OPTIONS: () => apiOptions(),
    },
  },
})
