import { publicModelId } from "./model-registry"
import type { ManagedModel } from "./model-registry"

function reasoningLevels(model: ManagedModel) {
  if (model.reasoningCapability?.kind !== "effort") {
    return []
  }

  return model.reasoningCapability.levels.map((effort) => ({
    effort,
    description:
      effort === "low"
        ? "Faster responses with lighter reasoning."
        : effort === "high"
          ? "More thorough reasoning for complex tasks."
          : "Balanced reasoning for everyday coding.",
  }))
}

function defaultReasoningLevel(model: ManagedModel) {
  return model.reasoningCapability?.kind === "effort" ? "medium" : null
}

function shellType(_model: ManagedModel) {
  return "shell_command"
}

function inputModalities(model: ManagedModel) {
  return model.inputModalities?.length ? model.inputModalities : ["text"]
}

export function toCodexModelCatalog(models: Array<ManagedModel>) {
  return {
    models: models.map((model, index) => {
      if (model.codexModelInfo) {
        return model.codexModelInfo
      }

      return {
        slug: publicModelId(model),
        display_name: model.displayName,
        description:
          model.provider === "openrouter"
            ? `OpenRouter model routed through Codex Model Manager (${model.upstreamModel}).`
            : "OpenAI/Codex model routed through Codex Model Manager.",
        default_reasoning_level: defaultReasoningLevel(model),
        supported_reasoning_levels: reasoningLevels(model),
        shell_type: shellType(model),
        visibility: "list",
        supported_in_api: true,
        priority: index,
        additional_speed_tiers: [],
        service_tiers: [],
        availability_nux: null,
        upgrade: null,
        base_instructions: "",
        model_messages: null,
        supports_reasoning_summaries: false,
        default_reasoning_summary: "auto",
        support_verbosity: false,
        default_verbosity: null,
        apply_patch_tool_type: null,
        web_search_tool_type: "text",
        truncation_policy: {
          mode: "tokens",
          limit: model.contextWindow || 128000,
        },
        supports_parallel_tool_calls: true,
        supports_image_detail_original: inputModalities(model).includes("image"),
        context_window: model.contextWindow || null,
        max_context_window: model.contextWindow || null,
        auto_compact_token_limit: model.contextWindow
          ? Math.floor(model.contextWindow * 0.9)
          : null,
        effective_context_window_percent: 95,
        experimental_supported_tools: [],
        input_modalities: inputModalities(model),
        supports_search_tool: false,
      }
    }),
  }
}
