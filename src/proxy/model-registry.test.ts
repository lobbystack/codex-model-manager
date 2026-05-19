import { describe, expect, it } from "vitest"

import {
  openCodeZenInputModalitiesForModel,
  openCodeZenSettingToManagedModel,
} from "./model-registry"

describe("OpenCode Zen model capabilities", () => {
  it("marks DeepSeek and GLM models as text-only", () => {
    expect(
      openCodeZenInputModalitiesForModel("opencode/deepseek-v4-flash-free")
    ).toEqual(["text"])
    expect(openCodeZenInputModalitiesForModel("opencode/glm-5.1")).toEqual([
      "text",
    ])
  })

  it("keeps known vision-capable Zen families image-capable", () => {
    expect(openCodeZenInputModalitiesForModel("opencode/gpt-5.5")).toEqual([
      "text",
      "image",
    ])
    expect(
      openCodeZenInputModalitiesForModel("opencode/claude-sonnet-4-6")
    ).toEqual(["text", "image"])
    expect(
      openCodeZenInputModalitiesForModel("opencode/gemini-3.1-pro")
    ).toEqual(["text", "image"])
  })

  it("does not let stale settings advertise images for text-only Zen models", () => {
    expect(
      openCodeZenSettingToManagedModel({
        id: "opencode/glm-5.1",
        displayName: "GLM 5.1",
        upstreamModel: "glm-5.1",
        enabled: true,
        contextWindow: 0,
        outputLimit: 65536,
        inputModalities: ["text", "image"],
      }).inputModalities
    ).toEqual(["text"])
  })
})
