import { gunzipSync, inflateSync, zstdDecompressSync } from "node:zlib"

import {
  codexModelInfoToManagedModel,
  managedModels,
  openRouterSettingToManagedModel,
  publicModelId,
  toOpenAIModelList,
} from "./model-registry"
import { toCodexModelCatalog } from "./codex-catalog"
import { forwardChatCompletions, forwardResponses } from "./upstreams"
import type { CodexModelInfo, ManagedModel } from "./model-registry"
import {
  getActiveAccount,
  listChatGptModelSettings,
  listOpenRouterModelSettings,
} from "@/server/accounts/store"
import { writeCodexModelCatalog } from "@/server/codex/catalog-file"
import { getActiveAccessToken } from "@/server/oauth/service"

const MAX_DECOMPRESSED_BODY_BYTES = 32 * 1024 * 1024

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

export async function fetchChatGptCodexModels(): Promise<Array<ManagedModel>> {
  const account = await getActiveAccount()
  const token = account ? await getActiveAccessToken() : null

  if (!account || !token) {
    return []
  }

  const headers = new Headers({
    accept: "application/json",
    authorization: `Bearer ${token}`,
  })

  if (account.chatgptAccountId) {
    headers.set("chatgpt-account-id", account.chatgptAccountId)
  }

  try {
    const response = await fetch(
      "https://chatgpt.com/backend-api/codex/models?client_version=0.0.0",
      { headers }
    )

    if (!response.ok) {
      return []
    }

    const data = (await response.json()) as { models?: Array<CodexModelInfo> }
    return (data.models || [])
      .filter((model) => typeof model.slug === "string" && model.slug)
      .map(codexModelInfoToManagedModel)
  } catch {
    return []
  }
}

async function fetchOpenRouterModelCapabilities() {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { accept: "application/json" },
    })

    if (!response.ok) {
      return new Map<string, Array<string>>()
    }

    const data = (await response.json()) as {
      data?: Array<{ id?: string; supported_parameters?: Array<string> }>
    }

    return new Map(
      (data.data || [])
        .filter((model) => typeof model.id === "string" && model.id)
        .map((model) => [
          `openrouter/${model.id}`,
          model.supported_parameters || [],
        ])
    )
  } catch {
    return new Map<string, Array<string>>()
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

export async function getEnabledModels() {
  const settings = await listOpenRouterModelSettings()
  const chatGptSettings = await listChatGptModelSettings()
  const liveOpenAIModels = await fetchChatGptCodexModels()
  const chatGptSettingsById = new Map(
    chatGptSettings.map((model) => [model.id, model])
  )
  const enabledLiveOpenAIModels = liveOpenAIModels.filter(
    (model) => chatGptSettingsById.get(model.id)?.enabled ?? model.enabled
  )
  const openRouterCapabilities = settings.some(
    (model) => model.providerName || model.id.startsWith("openrouter/")
  )
    ? await fetchOpenRouterModelCapabilities()
    : new Map<string, Array<string>>()
  const hasOpenRouterSettings = settings.length > 0
  const settingsById = new Map(settings.map((model) => [model.id, model]))
  const staticModels = managedModels.filter((model) => {
    if (model.provider === "openai-pool" && liveOpenAIModels.length > 0) {
      return false
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
      const supportedParameters =
        openRouterCapabilities.get(model.id) || model.supportedParameters || []
      return openRouterSettingToManagedModel({
        ...model,
        supportedParameters,
      })
    })

  return [
    ...enabledLiveOpenAIModels,
    ...staticModels,
    ...configuredOpenRouterModels,
  ]
}

export async function getHealth() {
  const models = await getEnabledModels()
  await writeCodexModelCatalog(models)
  return proxyJson({ ok: true, models: models.length })
}

export async function getOpenAIModels() {
  const models = await getEnabledModels()
  await writeCodexModelCatalog(models)
  return proxyJson(toOpenAIModelList(models))
}

export async function getCodexModels() {
  const models = await getEnabledModels()
  await writeCodexModelCatalog(models)
  return proxyJson(toCodexModelCatalog(models))
}

export async function getManagedModels() {
  const models = await getEnabledModels()
  await writeCodexModelCatalog(models)
  return proxyJson({ models })
}

export function optionsResponse() {
  return proxyJson({ ok: true })
}

export async function routeProxyRequest(
  request: Request,
  kind: "chat" | "responses"
) {
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

  const model = (await getEnabledModels()).find(
    (candidate) =>
      candidate.id === modelId || publicModelId(candidate) === modelId
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
    return forwardChatCompletions({ request, model, body })
  }

  return forwardResponses({ request, model, body })
}
