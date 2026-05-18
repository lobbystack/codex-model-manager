import { createFileRoute } from "@tanstack/react-router"

import { getEnabledModels } from "@/proxy/handlers"
import { apiJson, apiOptions, readJson } from "@/server/api/json"
import {
  getOllamaCloudKey,
  listOllamaCloudModelSettings,
  upsertOllamaCloudKey,
  upsertOllamaCloudModelSetting,
} from "@/server/accounts/store"
import { writeCodexModelCatalog } from "@/server/codex/catalog-file"

type OllamaCloudModel = {
  id?: string
  name?: string
}

const PROVIDER_MODELS_CACHE_TTL_MS = 5 * 60 * 1000
const ollamaCloudInputModalities = ["text"]
const defaultEnabledModelIds = new Set([
  "ollama/gpt-oss:120b",
  "ollama/gpt-oss:20b",
])

let ollamaCloudModelsCache:
  | { expiresAt: number; models: Array<OllamaCloudModel> }
  | undefined

function displayNameForModel(id: string) {
  return id
    .replace(/:cloud$/, " Cloud")
    .split(/[-:.]/)
    .filter(Boolean)
    .map((part) => {
      if (part.toLowerCase() === "gpt") {
        return "GPT"
      }

      if (part.toLowerCase() === "oss") {
        return "OSS"
      }

      return part[0].toUpperCase() + part.slice(1)
    })
    .join(" ")
}

async function fetchOllamaCloudModels() {
  const key = (await getOllamaCloudKey()) || process.env.OLLAMA_API_KEY

  if (!key) {
    throw new Response("Ollama Cloud API key is required.", { status: 401 })
  }

  const response = await fetch("https://ollama.com/api/tags", {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${key}`,
    },
  })

  if (!response.ok) {
    throw response
  }

  const data = (await response.json()) as { models?: Array<OllamaCloudModel> }
  return data.models || []
}

async function getCachedOllamaCloudModels() {
  if (ollamaCloudModelsCache && ollamaCloudModelsCache.expiresAt > Date.now()) {
    return ollamaCloudModelsCache.models
  }

  const models = await fetchOllamaCloudModels()

  ollamaCloudModelsCache = {
    expiresAt: Date.now() + PROVIDER_MODELS_CACHE_TTL_MS,
    models,
  }

  return models
}

async function listOllamaCloudModels() {
  let upstreamModels: Array<OllamaCloudModel>

  try {
    upstreamModels = await getCachedOllamaCloudModels()
  } catch (error) {
    return apiJson(
      { error: { message: "Unable to load Ollama Cloud models." } },
      error instanceof Response ? error.status : 500
    )
  }

  const settings = await listOllamaCloudModelSettings()
  const hasSettings = settings.length > 0
  const hasProviderKey = Boolean(
    (await getOllamaCloudKey()) || process.env.OLLAMA_API_KEY
  )
  const settingsById = new Map(settings.map((model) => [model.id, model]))
  const models = upstreamModels.flatMap((model) => {
    const upstreamModel = model.name || model.id

    if (!upstreamModel) {
      return []
    }

    const id = `ollama/${upstreamModel}`
    const setting = settingsById.get(id)

    return [
      {
        id,
        displayName: setting?.displayName || displayNameForModel(upstreamModel),
        provider: "ollama-cloud",
        providerName: setting?.providerName || "Ollama",
        upstreamModel,
        enabled:
          setting?.enabled ??
          (!hasSettings && hasProviderKey && defaultEnabledModelIds.has(id)),
        supportsResponses: true,
        supportsChatCompletions: true,
        supportsReasoning: setting?.supportsReasoning || false,
        supportedParameters: setting?.supportedParameters || [],
        contextWindow: setting?.contextWindow || 0,
        outputLimit: setting?.outputLimit || 0,
        inputModalities: setting?.inputModalities || ollamaCloudInputModalities,
      },
    ]
  })

  return apiJson({ models })
}

async function persistDefaultOllamaCloudModels() {
  const upstreamModels = await getCachedOllamaCloudModels()
  const settings = await listOllamaCloudModelSettings()

  if (settings.length > 0) {
    return
  }

  for (const model of upstreamModels) {
    const upstreamModel = model.name || model.id

    if (!upstreamModel) {
      continue
    }

    const id = `ollama/${upstreamModel}`

    if (!defaultEnabledModelIds.has(id)) {
      continue
    }

    await upsertOllamaCloudModelSetting({
      id,
      displayName: displayNameForModel(upstreamModel),
      providerName: "Ollama",
      upstreamModel,
      enabled: true,
      supportsReasoning: false,
      supportedParameters: [],
      contextWindow: 0,
      outputLimit: 0,
      inputModalities: ollamaCloudInputModalities,
    })
  }
}

async function updateOllamaCloudModel(request: Request) {
  const body = await readJson(request)

  if (typeof body.id !== "string" || !body.id.startsWith("ollama/")) {
    return apiJson(
      { error: { message: "Ollama Cloud model id is required." } },
      400
    )
  }

  if (typeof body.enabled !== "boolean") {
    return apiJson({ error: { message: "Enabled must be a boolean." } }, 400)
  }

  const upstreamModel =
    typeof body.upstreamModel === "string"
      ? body.upstreamModel
      : body.id.replace(/^ollama\//, "")
  const displayName =
    typeof body.displayName === "string" && body.displayName.trim()
      ? body.displayName.trim()
      : displayNameForModel(upstreamModel)
  const providerName =
    typeof body.providerName === "string" && body.providerName.trim()
      ? body.providerName.trim()
      : "Ollama"
  const supportedParameters = Array.isArray(body.supportedParameters)
    ? body.supportedParameters.filter(
        (parameter) => typeof parameter === "string"
      )
    : []
  const inputModalities = Array.isArray(body.inputModalities)
    ? body.inputModalities.filter((modality) => typeof modality === "string")
    : ollamaCloudInputModalities

  const model = await upsertOllamaCloudModelSetting({
    id: body.id,
    displayName,
    providerName,
    upstreamModel,
    enabled: body.enabled,
    supportsReasoning:
      typeof body.supportsReasoning === "boolean"
        ? body.supportsReasoning
        : false,
    supportedParameters,
    contextWindow:
      typeof body.contextWindow === "number" ? body.contextWindow : 0,
    outputLimit: typeof body.outputLimit === "number" ? body.outputLimit : 0,
    inputModalities,
  })

  await writeCodexModelCatalog(await getEnabledModels())

  return apiJson({ model })
}

export const Route = createFileRoute("/api/providers/ollama-cloud")({
  server: {
    handlers: {
      GET: () => listOllamaCloudModels(),
      PATCH: ({ request }) => updateOllamaCloudModel(request),
      POST: async ({ request }) => {
        const body = await readJson(request)

        if (typeof body.apiKey !== "string" || !body.apiKey.trim()) {
          return apiJson(
            { error: { message: "Ollama Cloud API key is required." } },
            400
          )
        }

        const provider = await upsertOllamaCloudKey(body.apiKey)
        ollamaCloudModelsCache = undefined
        await persistDefaultOllamaCloudModels()

        return apiJson({ provider })
      },
      OPTIONS: () => apiOptions(),
    },
  },
})
