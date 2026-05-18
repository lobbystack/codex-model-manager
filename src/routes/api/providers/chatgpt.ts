import { createFileRoute } from "@tanstack/react-router"

import type { ManagedModel } from "@/proxy/model-registry"
import { fetchChatGptCodexModels, getCodexCatalogModels } from "@/proxy/handlers"
import { apiJson, apiOptions, readJson } from "@/server/api/json"
import {
  listChatGptModelSettings,
  upsertChatGptModelSetting,
} from "@/server/accounts/store"
import { writeCodexModelCatalog } from "@/server/codex/catalog-file"

const PROVIDER_MODELS_CACHE_TTL_MS = 5 * 60 * 1000

let chatGptModelsCache:
  | { expiresAt: number; models: Array<ManagedModel> }
  | undefined

async function getCachedChatGptCodexModels() {
  if (chatGptModelsCache && chatGptModelsCache.expiresAt > Date.now()) {
    return chatGptModelsCache.models
  }

  const models = await fetchChatGptCodexModels()

  chatGptModelsCache = {
    expiresAt: Date.now() + PROVIDER_MODELS_CACHE_TTL_MS,
    models,
  }

  return models
}

async function listChatGptModels() {
  const models = await getCachedChatGptCodexModels()
  const settings = await listChatGptModelSettings()
  const settingsById = new Map(settings.map((model) => [model.id, model]))

  return apiJson({
    models: models.map((model) => ({
      id: model.id,
      displayName: settingsById.get(model.id)?.displayName || model.displayName,
      providerName: "ChatGPT",
      upstreamModel: model.upstreamModel,
      enabled: settingsById.get(model.id)?.enabled ?? model.enabled,
      supportsReasoning: model.supportsReasoning,
      supportedParameters: model.supportedParameters || [],
      contextWindow: model.contextWindow,
      outputLimit: model.outputLimit,
      serviceTiers: model.codexModelInfo?.service_tiers || [],
      additionalSpeedTiers: model.codexModelInfo?.additional_speed_tiers || [],
    })),
  })
}

async function updateChatGptModel(request: Request) {
  const body = await readJson(request)

  if (typeof body.id !== "string" || !body.id.trim()) {
    return apiJson({ error: { message: "ChatGPT model id is required." } }, 400)
  }

  if (typeof body.enabled !== "boolean") {
    return apiJson({ error: { message: "Enabled must be a boolean." } }, 400)
  }

  const displayName =
    typeof body.displayName === "string" && body.displayName.trim()
      ? body.displayName.trim()
      : body.id

  const model = await upsertChatGptModelSetting({
    id: body.id,
    displayName,
    enabled: body.enabled,
  })

  await writeCodexModelCatalog(await getCodexCatalogModels())

  return apiJson({ model })
}

export const Route = createFileRoute("/api/providers/chatgpt")({
  server: {
    handlers: {
      GET: () => listChatGptModels(),
      PATCH: ({ request }) => updateChatGptModel(request),
      OPTIONS: () => apiOptions(),
    },
  },
})
