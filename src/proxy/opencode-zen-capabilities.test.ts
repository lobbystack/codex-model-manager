import { describe, expect, it } from "vitest"

import {
  clampZenInputModalities,
  extractZenInputModalitiesFromMetadata,
  mergeZenModelCapabilities,
  normalizeZenInputModalities,
  openCodeZenInputModalitiesFallback,
  resolveZenInputModalities,
} from "./opencode-zen-capabilities"
import { openCodeZenSettingToManagedModel } from "./model-registry"

describe("OpenCode Zen capability metadata", () => {
  it("normalizes provider modalities to Codex-safe input modalities", () => {
    expect(normalizeZenInputModalities(["text", "image", "video"])).toEqual([
      "text",
      "image",
    ])
    expect(normalizeZenInputModalities(["text"])).toEqual(["text"])
    expect(normalizeZenInputModalities(undefined)).toEqual(["text"])
  })

  it("reads modalities from models.dev-style metadata", () => {
    expect(
      extractZenInputModalitiesFromMetadata({
        id: "kimi-k2.6",
        modalities: {
          input: ["text", "image", "video"],
          output: ["text"],
        },
      })
    ).toEqual(["text", "image"])
  })

  it("merges Zen model ids with models.dev metadata by exact id", () => {
    expect(
      mergeZenModelCapabilities(
        { id: "kimi-k2.6" },
        {
          id: "kimi-k2.6",
          name: "Kimi K2.6",
          modalities: {
            input: ["text", "image", "video"],
            output: ["text"],
          },
          limit: {
            context: 262144,
            output: 65536,
          },
        }
      )
    ).toMatchObject({
      displayName: "Kimi K2.6",
      inputModalities: ["text", "image"],
      contextWindow: 262144,
      outputLimit: 65536,
    })
  })

  it("prefers metadata over stale stored modalities", () => {
    expect(
      resolveZenInputModalities({
        modelId: "opencode/glm-5.1",
        metadata: {
          id: "glm-5.1",
          modalities: {
            input: ["text"],
            output: ["text"],
          },
        },
        storedModalities: ["text", "image"],
      })
    ).toEqual(["text"])
  })

  it("falls back to prefix heuristics only when metadata is unavailable", () => {
    expect(
      resolveZenInputModalities({
        modelId: "opencode/gpt-5.5",
      })
    ).toEqual(["text", "image"])
    expect(
      resolveZenInputModalities({
        modelId: "opencode/deepseek-v4-flash-free",
      })
    ).toEqual(["text"])
    expect(openCodeZenInputModalitiesFallback("opencode/claude-sonnet-4-6")).toEqual(
      ["text", "image"]
    )
  })

  it("clamps requested modalities to metadata-derived allowed values", () => {
    expect(
      clampZenInputModalities(["text", "image"], ["text"])
    ).toEqual(["text"])
    expect(
      clampZenInputModalities(["text", "image"], ["text", "image"])
    ).toEqual(["text", "image"])
    expect(clampZenInputModalities(undefined, ["text", "image"])).toEqual([
      "text",
      "image",
    ])
  })
})

describe("OpenCode Zen managed model conversion", () => {
  it("keeps Kimi K2.6 image-capable when metadata supports images", () => {
    expect(
      openCodeZenSettingToManagedModel(
        {
          id: "opencode/kimi-k2.6",
          displayName: "Kimi K2.6",
          upstreamModel: "kimi-k2.6",
          enabled: true,
          contextWindow: 262144,
          outputLimit: 65536,
          inputModalities: ["text", "image"],
        },
        {
          id: "kimi-k2.6",
          modalities: {
            input: ["text", "image", "video"],
            output: ["text"],
          },
        }
      ).inputModalities
    ).toEqual(["text", "image"])
  })

  it("keeps Kimi K2 Thinking text-only", () => {
    expect(
      openCodeZenSettingToManagedModel(
        {
          id: "opencode/kimi-k2-thinking",
          displayName: "Kimi K2 Thinking",
          upstreamModel: "kimi-k2-thinking",
          enabled: true,
          contextWindow: 262144,
          outputLimit: 65536,
        },
        {
          id: "kimi-k2-thinking",
          modalities: {
            input: ["text"],
            output: ["text"],
          },
        }
      ).inputModalities
    ).toEqual(["text"])
  })

  it("does not let stale settings advertise images for text-only Zen models", () => {
    expect(
      openCodeZenSettingToManagedModel(
        {
          id: "opencode/glm-5.1",
          displayName: "GLM 5.1",
          upstreamModel: "glm-5.1",
          enabled: true,
          contextWindow: 0,
          outputLimit: 65536,
          inputModalities: ["text", "image"],
        },
        {
          id: "glm-5.1",
          modalities: {
            input: ["text"],
            output: ["text"],
          },
        }
      ).inputModalities
    ).toEqual(["text"])
  })
})
