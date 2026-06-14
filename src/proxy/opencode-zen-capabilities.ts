export type ZenModelMetadata = {
  id: string
  name?: string
  object?: string
  owned_by?: string
  architecture?: {
    input_modalities?: Array<string>
  }
  modalities?: {
    input?: Array<string>
    output?: Array<string>
  }
  limit?: {
    context?: number
    output?: number
  }
}

export type ZenModelCapabilities = {
  displayName?: string
  inputModalities: Array<string>
  contextWindow?: number
  outputLimit?: number
}

const TEXT_MODALITIES = ["text"]
const MODELS_DEV_CACHE_TTL_MS = 5 * 60 * 1000
const MODELS_DEV_URL = "https://models.dev/api.json"
const ZEN_VISION_MODEL_PREFIXES = ["claude-", "gemini-", "gpt-"]

let modelsDevOpenCodeCache:
  | { expiresAt: number; models: Map<string, ZenModelMetadata> }
  | undefined

export function normalizeZenInputModalities(
  modalities: Array<string> | undefined
): Array<string> {
  if (!modalities?.length) {
    return TEXT_MODALITIES
  }

  const normalized = new Set<string>(["text"])

  if (modalities.includes("image")) {
    normalized.add("image")
  }

  return [...normalized]
}

export function extractZenInputModalitiesFromMetadata(
  metadata: ZenModelMetadata | undefined
): Array<string> | undefined {
  if (!metadata) {
    return undefined
  }

  const fromArchitecture = metadata.architecture?.input_modalities
  const fromModalities = metadata.modalities?.input
  const rawModalities = fromArchitecture?.length
    ? fromArchitecture
    : fromModalities

  if (!rawModalities?.length) {
    return undefined
  }

  return normalizeZenInputModalities(rawModalities)
}

export function openCodeZenInputModalitiesFallback(modelId: string) {
  const upstreamModel = modelId.replace(/^opencode\//, "")

  if (
    ZEN_VISION_MODEL_PREFIXES.some((prefix) => upstreamModel.startsWith(prefix))
  ) {
    return ["text", "image"]
  }

  return TEXT_MODALITIES
}

export function resolveZenInputModalities({
  modelId,
  metadata,
  storedModalities,
}: {
  modelId: string
  metadata?: ZenModelMetadata
  storedModalities?: Array<string>
}) {
  const metadataModalities = extractZenInputModalitiesFromMetadata(metadata)

  if (metadataModalities) {
    return metadataModalities
  }

  if (storedModalities?.length) {
    return normalizeZenInputModalities(storedModalities)
  }

  return openCodeZenInputModalitiesFallback(modelId)
}

export function mergeZenModelCapabilities(
  zenModel: ZenModelMetadata,
  modelsDevMetadata?: ZenModelMetadata
): ZenModelCapabilities {
  const inputModalities = resolveZenInputModalities({
    modelId: `opencode/${zenModel.id}`,
    metadata: {
      ...modelsDevMetadata,
      ...zenModel,
      architecture: zenModel.architecture || modelsDevMetadata?.architecture,
      modalities: zenModel.modalities || modelsDevMetadata?.modalities,
      limit: zenModel.limit || modelsDevMetadata?.limit,
    },
  })

  return {
    displayName: zenModel.name || modelsDevMetadata?.name,
    inputModalities,
    contextWindow:
      zenModel.limit?.context ?? modelsDevMetadata?.limit?.context,
    outputLimit: zenModel.limit?.output ?? modelsDevMetadata?.limit?.output,
  }
}

export function clampZenInputModalities(
  requested: Array<string> | undefined,
  allowed: Array<string>
) {
  if (!requested?.length) {
    return allowed
  }

  const filtered = requested.filter((modality) => allowed.includes(modality))
  return filtered.length > 0 ? filtered : allowed
}

async function fetchModelsDevOpenCodeMetadata() {
  const response = await fetch(MODELS_DEV_URL, {
    headers: {
      accept: "application/json",
      "user-agent": "codex-model-manager",
    },
  })

  if (!response.ok) {
    return new Map<string, ZenModelMetadata>()
  }

  const data = (await response.json()) as {
    opencode?: { models?: Record<string, ZenModelMetadata> }
  }

  return new Map(
    Object.entries(data.opencode?.models || {}).map(([id, metadata]) => [
      id,
      { ...metadata, id },
    ])
  )
}

export async function getModelsDevOpenCodeMetadata() {
  if (
    modelsDevOpenCodeCache &&
    modelsDevOpenCodeCache.expiresAt > Date.now()
  ) {
    return modelsDevOpenCodeCache.models
  }

  const models = await fetchModelsDevOpenCodeMetadata()

  modelsDevOpenCodeCache = {
    expiresAt:
      Date.now() + (models.size > 0 ? MODELS_DEV_CACHE_TTL_MS : 10_000),
    models,
  }

  return models
}

export function clearModelsDevOpenCodeCache() {
  modelsDevOpenCodeCache = undefined
}

export async function getZenModelCapabilitiesById(upstreamModelId: string) {
  const metadataById = await getModelsDevOpenCodeMetadata()
  const metadata = metadataById.get(upstreamModelId)

  return mergeZenModelCapabilities(
    { id: upstreamModelId, ...metadata },
    metadata
  )
}
