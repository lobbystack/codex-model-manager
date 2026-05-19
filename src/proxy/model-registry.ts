export type ProviderId =
  | "openai-pool"
  | "openrouter"
  | "opencode-zen"
  | "ollama-cloud"

export type ManagedModel = {
  id: string
  displayName: string
  provider: ProviderId
  upstreamModel: string
  enabled: boolean
  supportsResponses: boolean
  supportsChatCompletions: boolean
  supportsReasoning: boolean
  supportedParameters?: Array<string>
  reasoningCapability?: ReasoningCapability
  contextWindow: number
  outputLimit: number
  inputModalities?: Array<string>
  codexModelInfo?: CodexModelInfo
}

export type ReasoningEffortLevel =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"

export type ReasoningCapability =
  | { kind: "none" }
  | { kind: "tokens" }
  | { kind: "binary"; enabledByDefault: boolean }
  | { kind: "budget" }
  | { kind: "effort"; levels: Array<ReasoningEffortLevel> }

export type CodexReasoningLevel = {
  effort: string
  description: string
}

export type CodexModelInfo = {
  slug: string
  display_name: string
  description?: string | null
  default_reasoning_level?: string | null
  supported_reasoning_levels?: Array<CodexReasoningLevel>
  shell_type?: string
  visibility?: string
  supported_in_api?: boolean
  priority?: number
  additional_speed_tiers?: Array<string>
  service_tiers?: Array<{ id: string; name: string; description: string }>
  availability_nux?: { message: string } | null
  upgrade?: { model: string; migration_markdown: string } | null
  base_instructions?: string
  model_messages?: unknown
  supports_reasoning_summaries?: boolean
  default_reasoning_summary?: string
  support_verbosity?: boolean
  default_verbosity?: string | null
  apply_patch_tool_type?: string | null
  web_search_tool_type?: string
  truncation_policy?: { mode: string; limit: number }
  supports_parallel_tool_calls?: boolean
  supports_image_detail_original?: boolean
  context_window?: number | null
  max_context_window?: number | null
  auto_compact_token_limit?: number | null
  effective_context_window_percent?: number
  experimental_supported_tools?: Array<string>
  input_modalities?: Array<string>
  supports_search_tool?: boolean
  [key: string]: unknown
}

export type OpenRouterModelSetting = {
  id: string
  displayName: string
  upstreamModel: string
  enabled: boolean
  supportsReasoning?: boolean
  supportedParameters?: Array<string>
  contextWindow: number
  outputLimit: number
  inputModalities?: Array<string>
}

export type OpenCodeZenModelFamily =
  | "responses"
  | "chat"
  | "messages"
  | "gemini"

export type OpenCodeZenModelSetting = {
  id: string
  displayName: string
  upstreamModel: string
  enabled: boolean
  supportsReasoning?: boolean
  supportedParameters?: Array<string>
  contextWindow: number
  outputLimit: number
  inputModalities?: Array<string>
}

export type OllamaCloudModelSetting = {
  id: string
  displayName: string
  upstreamModel: string
  enabled: boolean
  supportsReasoning?: boolean
  supportedParameters?: Array<string>
  contextWindow: number
  outputLimit: number
  inputModalities?: Array<string>
}

const TEXT_MODALITIES = ["text"]
const ZEN_INPUT_MODALITIES = ["text", "image"]
const ZEN_VISION_MODEL_PREFIXES = ["claude-", "gemini-", "gpt-"]

const DEFAULT_EFFORT_LEVELS: Array<ReasoningEffortLevel> = [
  "low",
  "medium",
  "high",
]

function hasReasoningParameter(supportedParameters: Array<string>) {
  return (
    supportedParameters.includes("reasoning") ||
    supportedParameters.includes("include_reasoning") ||
    supportedParameters.includes("reasoning_effort")
  )
}

export function inferOpenRouterReasoningCapability(
  modelId: string,
  supportedParameters: Array<string> = []
): ReasoningCapability {
  const upstreamModel = modelId.replace(/^openrouter\//, "")

  if (
    upstreamModel === "moonshotai/kimi-k2.6" ||
    upstreamModel === "moonshotai/kimi-k2.5" ||
    upstreamModel.startsWith("moonshotai/kimi-k2-thinking")
  ) {
    return { kind: "binary", enabledByDefault: true }
  }

  if (upstreamModel.startsWith("google/gemini-3")) {
    return { kind: "effort", levels: DEFAULT_EFFORT_LEVELS }
  }

  if (
    upstreamModel.startsWith("openai/o") ||
    upstreamModel.startsWith("openai/gpt-5") ||
    upstreamModel.startsWith("x-ai/grok")
  ) {
    return hasReasoningParameter(supportedParameters)
      ? { kind: "effort", levels: DEFAULT_EFFORT_LEVELS }
      : { kind: "none" }
  }

  if (upstreamModel.startsWith("anthropic/claude")) {
    return hasReasoningParameter(supportedParameters)
      ? { kind: "budget" }
      : { kind: "none" }
  }

  if (hasReasoningParameter(supportedParameters)) {
    return { kind: "tokens" }
  }

  return { kind: "none" }
}

export function openCodeZenModelFamily(
  modelId: string
): OpenCodeZenModelFamily {
  const upstreamModel = modelId.replace(/^opencode\//, "")

  if (upstreamModel.startsWith("claude-")) {
    return "messages"
  }

  if (upstreamModel.startsWith("gemini-")) {
    return "gemini"
  }

  if (upstreamModel.startsWith("gpt-")) {
    return "responses"
  }

  return "chat"
}

export function openCodeZenInputModalitiesForModel(modelId: string) {
  const upstreamModel = modelId.replace(/^opencode\//, "")

  if (
    ZEN_VISION_MODEL_PREFIXES.some((prefix) => upstreamModel.startsWith(prefix))
  ) {
    return ZEN_INPUT_MODALITIES
  }

  return TEXT_MODALITIES
}

export function inferOpenCodeZenReasoningCapability(
  modelId: string
): ReasoningCapability {
  const upstreamModel = modelId.replace(/^opencode\//, "")

  if (upstreamModel.startsWith("gpt-") || upstreamModel.startsWith("gemini-")) {
    return { kind: "effort", levels: DEFAULT_EFFORT_LEVELS }
  }

  if (upstreamModel.startsWith("claude-")) {
    return { kind: "budget" }
  }

  if (upstreamModel.startsWith("kimi-")) {
    return { kind: "binary", enabledByDefault: true }
  }

  return { kind: "none" }
}

function supportsReasoning(capability: ReasoningCapability) {
  return capability.kind !== "none"
}

export const managedModels: Array<ManagedModel> = [
  {
    id: "gpt-5.3-codex",
    displayName: "GPT-5.3 Codex",
    provider: "openai-pool",
    upstreamModel: "gpt-5.3-codex",
    enabled: true,
    supportsResponses: true,
    supportsChatCompletions: false,
    supportsReasoning: true,
    reasoningCapability: { kind: "effort", levels: DEFAULT_EFFORT_LEVELS },
    contextWindow: 272000,
    outputLimit: 65536,
    inputModalities: TEXT_MODALITIES,
  },
  {
    id: "gpt-5.3-codex-spark",
    displayName: "GPT-5.3 Codex Spark",
    provider: "openai-pool",
    upstreamModel: "gpt-5.3-codex-spark",
    enabled: true,
    supportsResponses: true,
    supportsChatCompletions: false,
    supportsReasoning: true,
    reasoningCapability: { kind: "effort", levels: DEFAULT_EFFORT_LEVELS },
    contextWindow: 128000,
    outputLimit: 65536,
    inputModalities: TEXT_MODALITIES,
  },
  {
    id: "openrouter/anthropic/claude-sonnet-4.5",
    displayName: "Claude Sonnet 4.5",
    provider: "openrouter",
    upstreamModel: "anthropic/claude-sonnet-4.5",
    enabled: true,
    supportsResponses: true,
    supportsChatCompletions: true,
    supportsReasoning: true,
    contextWindow: 200000,
    outputLimit: 64000,
    inputModalities: TEXT_MODALITIES,
  },
  {
    id: "openrouter/google/gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    provider: "openrouter",
    upstreamModel: "google/gemini-2.5-pro",
    enabled: true,
    supportsResponses: true,
    supportsChatCompletions: true,
    supportsReasoning: true,
    contextWindow: 1048576,
    outputLimit: 65536,
    inputModalities: TEXT_MODALITIES,
  },
  {
    id: "openrouter/qwen/qwen3-coder",
    displayName: "Qwen3 Coder",
    provider: "openrouter",
    upstreamModel: "qwen/qwen3-coder",
    enabled: true,
    supportsResponses: true,
    supportsChatCompletions: true,
    supportsReasoning: false,
    contextWindow: 262144,
    outputLimit: 32768,
    inputModalities: TEXT_MODALITIES,
  },
]

export function enabledModels() {
  return managedModels.filter((model) => model.enabled)
}

export function resolveModel(modelId: string) {
  return enabledModels().find((model) => model.id === modelId)
}

export function openRouterSettingToManagedModel(
  model: OpenRouterModelSetting
): ManagedModel {
  const supportedParameters = model.supportedParameters || []
  const reasoningCapability = inferOpenRouterReasoningCapability(
    model.id,
    supportedParameters
  )

  return {
    id: model.id,
    displayName: model.displayName,
    provider: "openrouter",
    upstreamModel: model.upstreamModel,
    enabled: model.enabled,
    supportsResponses: true,
    supportsChatCompletions: true,
    supportsReasoning:
      model.supportsReasoning ?? supportsReasoning(reasoningCapability),
    supportedParameters,
    reasoningCapability,
    contextWindow: model.contextWindow,
    outputLimit: model.outputLimit,
    inputModalities: model.inputModalities || TEXT_MODALITIES,
  }
}

export function openCodeZenSettingToManagedModel(
  model: OpenCodeZenModelSetting
): ManagedModel {
  const reasoningCapability = inferOpenCodeZenReasoningCapability(model.id)
  const family = openCodeZenModelFamily(model.id)

  return {
    id: model.id,
    displayName: model.displayName,
    provider: "opencode-zen",
    upstreamModel: model.upstreamModel,
    enabled: model.enabled,
    supportsResponses: true,
    supportsChatCompletions: family === "chat",
    supportsReasoning:
      model.supportsReasoning ?? supportsReasoning(reasoningCapability),
    supportedParameters: model.supportedParameters || [],
    reasoningCapability,
    contextWindow: model.contextWindow,
    outputLimit: model.outputLimit,
    inputModalities: openCodeZenInputModalitiesForModel(model.id),
  }
}

export function ollamaCloudSettingToManagedModel(
  model: OllamaCloudModelSetting
): ManagedModel {
  return {
    id: model.id,
    displayName: model.displayName,
    provider: "ollama-cloud",
    upstreamModel: model.upstreamModel,
    enabled: model.enabled,
    supportsResponses: true,
    supportsChatCompletions: true,
    supportsReasoning: model.supportsReasoning ?? false,
    supportedParameters: model.supportedParameters || [],
    reasoningCapability: { kind: "none" },
    contextWindow: model.contextWindow,
    outputLimit: model.outputLimit,
    inputModalities: model.inputModalities || TEXT_MODALITIES,
  }
}

export function codexModelInfoToManagedModel(
  model: CodexModelInfo
): ManagedModel {
  const supportedReasoningLevels = model.supported_reasoning_levels || []
  const contextWindow = model.context_window || model.max_context_window || 0

  return {
    id: model.slug,
    displayName: model.display_name,
    provider: "openai-pool",
    upstreamModel: model.slug,
    enabled: model.visibility !== "hide" && model.visibility !== "none",
    supportsResponses: true,
    supportsChatCompletions: false,
    supportsReasoning: supportedReasoningLevels.length > 0,
    reasoningCapability:
      supportedReasoningLevels.length > 0
        ? { kind: "effort", levels: DEFAULT_EFFORT_LEVELS }
        : { kind: "none" },
    contextWindow,
    outputLimit: 0,
    inputModalities: model.input_modalities || TEXT_MODALITIES,
    codexModelInfo: model,
  }
}

export function publicModelId(model: ManagedModel) {
  if (model.provider !== "openrouter") {
    return model.id
  }

  return model.id.replace(/^openrouter\//, "openrouter-").replaceAll("/", "-")
}

export function toOpenAIModelList(models = enabledModels()) {
  return {
    object: "list",
    data: models.map((model) => ({
      id: publicModelId(model),
      object: "model",
      created: 0,
      owned_by: model.provider,
    })),
  }
}
