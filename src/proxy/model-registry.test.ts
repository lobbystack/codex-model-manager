import { describe, expect, it } from "vitest"

import {
  openCodeZenInputModalitiesForModel,
  openCodeZenSettingToManagedModel,
} from "./model-registry"
import { buildGeminiBody, textFunctionCallOutputItem } from "./upstreams"

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

  it("maps Codex reasoning effort to Gemini thinking level", () => {
    const model = openCodeZenSettingToManagedModel({
      id: "opencode/gemini-3.1-pro",
      displayName: "Gemini 3.1 Pro",
      upstreamModel: "gemini-3.1-pro",
      enabled: true,
      contextWindow: 1000000,
      outputLimit: 65536,
    })

    expect(
      buildGeminiBody({
        request: new Request("http://localhost/v1/responses"),
        model,
        body: {
          model: "opencode/gemini-3.1-pro",
          input: "Say OK",
          reasoning: { effort: "low" },
          max_output_tokens: 128,
        },
      })
    ).toMatchObject({
      contents: [{ role: "user", parts: [{ text: "Say OK" }] }],
      generationConfig: {
        maxOutputTokens: 128,
        thinkingConfig: { thinkingLevel: "low" },
      },
    })
  })

  it("does not force Gemini thinking when Codex sends no reasoning effort", () => {
    const model = openCodeZenSettingToManagedModel({
      id: "opencode/gemini-3.1-pro",
      displayName: "Gemini 3.1 Pro",
      upstreamModel: "gemini-3.1-pro",
      enabled: true,
      contextWindow: 1000000,
      outputLimit: 65536,
    })

    expect(
      buildGeminiBody({
        request: new Request("http://localhost/v1/responses"),
        model,
        body: {
          model: "opencode/gemini-3.1-pro",
          input: "Say OK",
        },
      })
    ).toMatchObject({
      contents: [{ role: "user", parts: [{ text: "Say OK" }] }],
      generationConfig: {},
    })
  })

  it("maps Codex function tools and tool turns to Gemini function parts", () => {
    const model = openCodeZenSettingToManagedModel({
      id: "opencode/gemini-3.1-pro",
      displayName: "Gemini 3.1 Pro",
      upstreamModel: "gemini-3.1-pro",
      enabled: true,
      contextWindow: 1000000,
      outputLimit: 65536,
    })

    expect(
      buildGeminiBody({
        request: new Request("http://localhost/v1/responses"),
        model,
        body: {
          model: "opencode/gemini-3.1-pro",
          input: [
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "Read package.json" }],
            },
            {
              type: "function_call",
              call_id: "call_1",
              name: "shell",
              arguments: '{"cmd":"cat package.json"}',
            },
            {
              type: "function_call_output",
              call_id: "call_1",
              output: '{"ok":true}',
            },
          ],
          tools: [
            {
              type: "function",
              name: "shell",
              description: "Run a shell command.",
              parameters: {
                type: "object",
                properties: { cmd: { type: "string" } },
                required: ["cmd"],
              },
            },
          ],
        },
      })
    ).toMatchObject({
      contents: [
        { role: "user", parts: [{ text: "Read package.json" }] },
        {
          role: "model",
          parts: [
            {
              text: 'Function call shell: {"cmd":"cat package.json"}',
            },
          ],
        },
        {
          role: "user",
          parts: [
            {
              text: 'Function response shell: {"ok":true}',
            },
          ],
        },
      ],
      tools: [
        {
          functionDeclarations: [
            {
              name: "shell",
              description: "Run a shell command.",
              parameters: {
                type: "object",
                properties: { cmd: { type: "string" } },
                required: ["cmd"],
              },
            },
          ],
        },
      ],
    })
  })

  it("converts Gemini text-form tool calls back into Codex function calls", () => {
    expect(
      textFunctionCallOutputItem(
        'Function call exec_command: {"cmd":"cat package.json"}'
      )
    ).toMatchObject({
      type: "function_call",
      status: "completed",
      name: "exec_command",
      arguments: '{"cmd":"cat package.json"}',
    })
  })
})
