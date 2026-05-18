import { createFileRoute } from "@tanstack/react-router"

import {
  inferOpenCodeZenReasoningCapability,
  openCodeZenModelFamily,
} from "@/proxy/model-registry"
import { getEnabledModels } from "@/proxy/handlers"
import { apiJson, apiOptions, readJson } from "@/server/api/json"
import {
  getOpenCodeZenKey,
  listOpenCodeZenModelSettings,
  upsertOpenCodeZenKey,
  upsertOpenCodeZenModelSetting,
} from "@/server/accounts/store"
import { writeCodexModelCatalog } from "@/server/codex/catalog-file"

type ZenModel = {
  id: string
  object?: string
  owned_by?: string
}

const PROVIDER_MODELS_CACHE_TTL_MS = 5 * 60 * 1000

let openCodeZenModelsCache:
  | { expiresAt: number; models: Array<ZenModel> }
  | undefined

const defaultEnabledModelIds = new Set([
  "opencode/gpt-5.5",
  "opencode/gpt-5.4-mini",
  "opencode/claude-sonnet-4-6",
  "opencode/gemini-3.1-pro",
  "opencode/kimi-k2.6",
])

const openCodeZenInputModalities = ["text", "image"]

const contextWindows: Record<string, number | undefined> = {
  "gpt-5.5": 272000,
  "gpt-5.5-pro": 272000,
  "gpt-5.4": 272000,
  "gpt-5.4-pro": 272000,
  "gpt-5.4-mini": 128000,
  "gpt-5.4-nano": 128000,
  "gpt-5.3-codex-spark": 128000,
  "gpt-5.3-codex": 272000,
  "gpt-5.2": 272000,
  "gpt-5.2-codex": 272000,
  "gpt-5.1": 272000,
  "gpt-5.1-codex": 272000,
  "gpt-5.1-codex-max": 272000,
  "gpt-5.1-codex-mini": 128000,
  "gpt-5": 272000,
  "gpt-5-codex": 272000,
  "gpt-5-nano": 128000,
  "claude-opus-4-7": 200000,
  "claude-opus-4-6": 200000,
  "claude-opus-4-5": 200000,
  "claude-opus-4-1": 200000,
  "claude-sonnet-4-6": 200000,
  "claude-sonnet-4-5": 200000,
  "claude-sonnet-4": 200000,
  "claude-haiku-4-5": 200000,
  "gemini-3.1-pro": 1000000,
  "gemini-3-flash": 1000000,
}

function titleCase(value: string) {
  return value
    .split(/[.-]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ")
}

function providerNameForModel(id: string) {
  if (id.startsWith("claude-")) {
    return "Anthropic"
  }

  if (id.startsWith("gemini-")) {
    return "Google"
  }

  if (id.startsWith("gpt-")) {
    return "OpenAI"
  }

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

  return "OpenCode Zen"
}

function displayNameForModel(id: string) {
  return titleCase(id).replace(/^Gpt\b/, "GPT").replace(/^Glm\b/, "GLM")
}

async function fetchOpenCodeZenModels() {
  const key = (await getOpenCodeZenKey()) || process.env.OPENCODE_ZEN_API_KEY
  const headers = new Headers({ accept: "application/json" })

  if (key) {
    headers.set("authorization", `Bearer ${key}`)
  }

  const response = await fetch("https://opencode.ai/zen/v1/models", {
    headers,
  })

  if (!response.ok) {
    throw response
  }

  const data = (await response.json()) as { data?: Array<ZenModel> }
  return data.data || []
}

async function getCachedOpenCodeZenModels() {
  if (openCodeZenModelsCache && openCodeZenModelsCache.expiresAt > Date.now()) {
    return openCodeZenModelsCache.models
  }

  const models = await fetchOpenCodeZenModels()

  openCodeZenModelsCache = {
    expiresAt: Date.now() + PROVIDER_MODELS_CACHE_TTL_MS,
    models,
  }

  return models
}

async function listOpenCodeZenModels() {
  let upstreamModels: Array<ZenModel>

  try {
    upstreamModels = await getCachedOpenCodeZenModels()
  } catch (error) {
    return apiJson(
      { error: { message: "Unable to load OpenCode Zen models." } },
      error instanceof Response ? error.status : 500
    )
  }

  const settings = await listOpenCodeZenModelSettings()
  const hasSettings = settings.length > 0
  const hasProviderKey = Boolean(
    (await getOpenCodeZenKey()) || process.env.OPENCODE_ZEN_API_KEY
  )
  const settingsById = new Map(settings.map((model) => [model.id, model]))
  const models = upstreamModels.map((model) => {
    const id = `opencode/${model.id}`
    const setting = settingsById.get(id)
    const reasoningCapability = inferOpenCodeZenReasoningCapability(id)
    const family = openCodeZenModelFamily(id)

    return {
      id,
      displayName: setting?.displayName || displayNameForModel(model.id),
      provider: "opencode-zen",
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
      contextWindow: setting?.contextWindow || contextWindows[model.id] || 0,
      outputLimit: setting?.outputLimit || 65536,
      inputModalities: setting?.inputModalities || openCodeZenInputModalities,
    }
  })

  return apiJson({
    models,
  })
}

async function persistDefaultOpenCodeZenModels() {
  const upstreamModels = await getCachedOpenCodeZenModels()
  const settings = await listOpenCodeZenModelSettings()

  if (settings.length > 0) {
    return
  }

  for (const model of upstreamModels) {
    const id = `opencode/${model.id}`

    if (!defaultEnabledModelIds.has(id)) {
      continue
    }

    const reasoningCapability = inferOpenCodeZenReasoningCapability(id)

    await upsertOpenCodeZenModelSetting({
      id,
      displayName: displayNameForModel(model.id),
      providerName: providerNameForModel(model.id),
      upstreamModel: model.id,
      enabled: true,
      supportsReasoning: reasoningCapability.kind !== "none",
      supportedParameters: [],
      contextWindow: contextWindows[model.id] || 0,
      outputLimit: 65536,
      inputModalities: openCodeZenInputModalities,
    })
  }
}

async function updateOpenCodeZenModel(request: Request) {
  const body = await readJson(request)

  if (typeof body.id !== "string" || !body.id.startsWith("opencode/")) {
    return apiJson(
      { error: { message: "OpenCode Zen model id is required." } },
      400
    )
  }

  if (typeof body.enabled !== "boolean") {
    return apiJson({ error: { message: "Enabled must be a boolean." } }, 400)
  }

  const upstreamModel =
    typeof body.upstreamModel === "string"
      ? body.upstreamModel
      : body.id.replace(/^opencode\//, "")
  const displayName =
    typeof body.displayName === "string" && body.displayName.trim()
      ? body.displayName.trim()
      : displayNameForModel(upstreamModel)
  const providerName =
    typeof body.providerName === "string" && body.providerName.trim()
      ? body.providerName.trim()
      : providerNameForModel(upstreamModel)
  const contextWindow =
    typeof body.contextWindow === "number"
      ? body.contextWindow
      : contextWindows[upstreamModel] || 0
  const outputLimit =
    typeof body.outputLimit === "number" ? body.outputLimit : 65536
  const supportedParameters = Array.isArray(body.supportedParameters)
    ? body.supportedParameters.filter((parameter) => typeof parameter === "string")
    : []
  const inputModalities = Array.isArray(body.inputModalities)
    ? body.inputModalities.filter((modality) => typeof modality === "string")
    : openCodeZenInputModalities
  const supportsReasoning =
    typeof body.supportsReasoning === "boolean"
      ? body.supportsReasoning
      : inferOpenCodeZenReasoningCapability(body.id).kind !== "none"

  const model = await upsertOpenCodeZenModelSetting({
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

export const Route = createFileRoute("/api/providers/opencode-zen")({
  server: {
    handlers: {
      GET: () => listOpenCodeZenModels(),
      PATCH: ({ request }) => updateOpenCodeZenModel(request),
      POST: async ({ request }) => {
        const body = await readJson(request)

        if (typeof body.apiKey !== "string" || !body.apiKey.trim()) {
          return apiJson(
            { error: { message: "OpenCode Zen API key is required." } },
            400
          )
        }

        const provider = await upsertOpenCodeZenKey(body.apiKey)
        openCodeZenModelsCache = undefined
        await persistDefaultOpenCodeZenModels()

        return apiJson({ provider })
      },
      OPTIONS: () => apiOptions(),
    },
  },
})
