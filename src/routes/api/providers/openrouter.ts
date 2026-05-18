import { createFileRoute } from "@tanstack/react-router"

import { apiJson, apiOptions, readJson } from "@/server/api/json"
import {
  inferOpenRouterReasoningCapability,
  managedModels,
} from "@/proxy/model-registry"
import { getEnabledModels } from "@/proxy/handlers"
import {
  getOpenRouterKey,
  listOpenRouterModelSettings,
  upsertOpenRouterKey,
  upsertOpenRouterModelSetting,
} from "@/server/accounts/store"
import { writeCodexModelCatalog } from "@/server/codex/catalog-file"

type OpenRouterModel = {
  id: string
  name?: string
  context_length?: number
  supported_parameters?: Array<string>
  top_provider?: {
    max_completion_tokens?: number
  }
}

const enabledOpenRouterModelIds = new Set(
  managedModels
    .filter((model) => model.provider === "openrouter" && model.enabled)
    .map((model) => model.id)
)

const managedOpenRouterModelsById = new Map(
  managedModels
    .filter((model) => model.provider === "openrouter")
    .map((model) => [model.id, model])
)

function titleCase(value: string) {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ")
}

function toManagedOpenRouterModel(
  model: OpenRouterModel,
  settingsById: Map<
    string,
    {
      enabled: boolean
      displayName: string
      providerName: string
      supportsReasoning?: boolean
      supportedParameters?: Array<string>
    }
  >,
  hasOpenRouterSettings: boolean
) {
  const id = `openrouter/${model.id}`
  const providerSlug = model.id.split("/")[0] || "openrouter"
  const setting = settingsById.get(id)
  const supportedParameters = model.supported_parameters || setting?.supportedParameters || []
  const reasoningCapability = inferOpenRouterReasoningCapability(
    id,
    supportedParameters
  )

  return {
    id,
    displayName: setting?.displayName || model.name || model.id,
    provider: "openrouter",
    providerName: setting?.providerName || titleCase(providerSlug),
    upstreamModel: model.id,
    enabled:
      setting?.enabled ??
      (!hasOpenRouterSettings && enabledOpenRouterModelIds.has(id)),
    supportsResponses: false,
    supportsChatCompletions: true,
    supportsReasoning:
      setting?.supportsReasoning ?? reasoningCapability.kind !== "none",
    supportedParameters,
    reasoningCapability,
    contextWindow: model.context_length || 0,
    outputLimit: model.top_provider?.max_completion_tokens || 0,
  }
}

async function listOpenRouterModels() {
  const key = (await getOpenRouterKey()) || process.env.OPENROUTER_API_KEY
  const headers = new Headers({ accept: "application/json" })

  if (key) {
    headers.set("authorization", `Bearer ${key}`)
  }

  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers,
  })

  if (!response.ok) {
    return apiJson(
      { error: { message: "Unable to load OpenRouter models." } },
      response.status
    )
  }

  const data = (await response.json()) as { data?: Array<OpenRouterModel> }
  const settings = await listOpenRouterModelSettings()
  const hasOpenRouterSettings = settings.length > 0
  const settingsById = new Map(settings.map((model) => [model.id, model]))

  return apiJson({
    models: (data.data || []).map((model) =>
      toManagedOpenRouterModel(model, settingsById, hasOpenRouterSettings)
    ),
  })
}

async function updateOpenRouterModel(request: Request) {
  const body = await readJson(request)

  if (typeof body.id !== "string" || !body.id.startsWith("openrouter/")) {
    return apiJson(
      { error: { message: "OpenRouter model id is required." } },
      400
    )
  }

  if (typeof body.enabled !== "boolean") {
    return apiJson({ error: { message: "Enabled must be a boolean." } }, 400)
  }

  const existing = managedOpenRouterModelsById.get(body.id)
  const upstreamModel =
    typeof body.upstreamModel === "string"
      ? body.upstreamModel
      : existing?.upstreamModel || body.id.replace(/^openrouter\//, "")
  const displayName =
    typeof body.displayName === "string" && body.displayName.trim()
      ? body.displayName.trim()
      : existing?.displayName || upstreamModel
  const providerSlug = upstreamModel.split("/")[0] || "openrouter"
  const providerName =
    typeof body.providerName === "string" && body.providerName.trim()
      ? body.providerName.trim()
      : titleCase(providerSlug)
  const contextWindow =
    typeof body.contextWindow === "number"
      ? body.contextWindow
      : existing?.contextWindow || 0
  const outputLimit =
    typeof body.outputLimit === "number"
      ? body.outputLimit
      : existing?.outputLimit || 0
  const supportedParameters = Array.isArray(body.supportedParameters)
    ? body.supportedParameters.filter((parameter) => typeof parameter === "string")
    : existing?.supportedParameters || []
  const supportsReasoning =
    typeof body.supportsReasoning === "boolean"
      ? body.supportsReasoning
      : supportedParameters.includes("reasoning") ||
        supportedParameters.includes("reasoning_effort")

  const model = await upsertOpenRouterModelSetting({
    id: body.id,
    displayName,
    providerName,
    upstreamModel,
    enabled: body.enabled,
    supportsReasoning,
    supportedParameters,
    contextWindow,
    outputLimit,
  })

  await writeCodexModelCatalog(await getEnabledModels())

  return apiJson({
    model,
  })
}

export const Route = createFileRoute("/api/providers/openrouter")({
  server: {
    handlers: {
      GET: () => listOpenRouterModels(),
      PATCH: ({ request }) => updateOpenRouterModel(request),
      POST: async ({ request }) => {
        const body = await readJson(request)

        if (typeof body.apiKey !== "string" || !body.apiKey.trim()) {
          return apiJson(
            { error: { message: "OpenRouter API key is required." } },
            400
          )
        }

        return apiJson({ provider: await upsertOpenRouterKey(body.apiKey) })
      },
      OPTIONS: () => apiOptions(),
    },
  },
})
