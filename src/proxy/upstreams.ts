import { openCodeZenModelFamily } from "./model-registry"
import type { ManagedModel } from "./model-registry"
import {
  getActiveAccount,
  getOpenCodeZenKey as getStoredOpenCodeZenKey,
  getOpenRouterKey as getStoredOpenRouterKey,
} from "@/server/accounts/store"
import { getActiveAccessToken } from "@/server/oauth/service"

type UpstreamRequest = {
  request: Request
  model: ManagedModel
  body: Record<string, unknown>
}

type ChatMessage = {
  role: string
  content?: string | Array<ChatContentPart>
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: "function"
    function: {
      name: string
      arguments: string
    }
  }>
}

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } }

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image"
      source:
        | { type: "base64"; media_type: string; data: string }
        | { type: "url"; url: string }
    }

type ChatToolCallDelta = {
  index?: number
  id?: string
  function?: {
    name?: string
    arguments?: string
  }
}

type ChatToolCall = {
  id: string
  type?: string
  function?: {
    name?: string
    arguments?: string
  }
}

type ChatTool = {
  type: "function"
  function: {
    name: unknown
    description: unknown
    parameters: unknown
  }
}

type OpenRouterChatChunk = {
  choices?: Array<{
    delta?: {
      content?: string
      tool_calls?: Array<ChatToolCallDelta>
    }
    finish_reason?: string | null
  }>
}

type OpenRouterChatResponse = {
  usage?: unknown
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: Array<ChatToolCall>
    }
  }>
}

type AnthropicMessageResponse = {
  id?: string
  content?: Array<{
    type?: string
    text?: string
    id?: string
    name?: string
    input?: unknown
  }>
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
  }
}

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
        functionCall?: { name?: string; args?: unknown }
      }>
    }
  }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
    cachedContentTokenCount?: number
  }
}

let openAIKeyIndex = 0

function getEnv(name: string) {
  return process.env[name]
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status })
}

const CODEX_CONTROL_RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-type",
  "etag",
  "last-modified",
  "location",
  "openai-processing-ms",
  "request-id",
  "x-request-id",
])

function getBearerToken(request: Request) {
  const auth = request.headers.get("authorization")

  if (!auth?.startsWith("Bearer ")) {
    return null
  }

  return auth.slice("Bearer ".length)
}

function getOpenAIKey() {
  const keys = (getEnv("CMM_OPENAI_KEYS") || getEnv("OPENAI_API_KEY") || "")
    .split(",")
    .map((key) => key.trim())
    .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool))

  if (keys.length === 0) {
    return null
  }

  const key = keys[openAIKeyIndex % keys.length]
  openAIKeyIndex += 1
  return key
}

function cloneHeaders(request: Request, bearer: string) {
  const headers = new Headers(request.headers)
  headers.set("authorization", `Bearer ${bearer}`)
  headers.set("content-type", "application/json")
  headers.delete("content-encoding")
  headers.delete("host")
  headers.delete("content-length")
  return headers
}

function cloneCodexControlHeaders(
  request: Request,
  bearer: string,
  accountId?: string | null,
  hasBody = false
) {
  const headers = new Headers(request.headers)
  headers.set("authorization", `Bearer ${bearer}`)
  headers.set("accept", request.headers.get("accept") || "*/*")

  if (accountId) {
    headers.set("chatgpt-account-id", accountId)
  }

  if (!hasBody && !request.headers.get("content-type")) {
    headers.delete("content-type")
  }

  headers.delete("content-encoding")
  headers.delete("host")
  headers.delete("content-length")
  return headers
}

function cloneCodexResponsesHeaders(
  request: Request,
  bearer: string,
  accountId?: string | null
) {
  const headers = cloneHeaders(request, bearer)
  headers.set("accept", "text/event-stream")

  if (accountId) {
    headers.set("chatgpt-account-id", accountId)
  }

  return headers
}

function normalizeCodexResponsesPayload(body: Record<string, unknown>) {
  const upstreamBody = { ...body }

  upstreamBody.model = "codex-auto-review"
  upstreamBody.store = false
  upstreamBody.stream = true

  delete upstreamBody.max_output_tokens
  delete upstreamBody.prompt_cache_retention
  delete upstreamBody.safety_identifier
  delete upstreamBody.temperature
  delete upstreamBody.top_p

  return upstreamBody
}

function codexControlResponseHeaders(headers: Headers) {
  const downstream = new Headers()

  for (const [key, value] of headers.entries()) {
    if (CODEX_CONTROL_RESPONSE_HEADERS.has(key.toLowerCase())) {
      downstream.set(key, value)
    }
  }

  return downstream
}

function cloneGoogleStyleHeaders(request: Request, apiKey: string) {
  const headers = new Headers(request.headers)
  headers.set("x-goog-api-key", apiKey)
  headers.set("content-type", "application/json")
  headers.delete("authorization")
  headers.delete("content-encoding")
  headers.delete("host")
  headers.delete("content-length")
  return headers
}

function sseHeaders() {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  }
}

function responseId() {
  return `resp_${crypto.randomUUID().replaceAll("-", "")}`
}

function outputItemId() {
  return `msg_${crypto.randomUUID().replaceAll("-", "")}`
}

function functionCallId() {
  return `fc_${crypto.randomUUID().replaceAll("-", "")}`
}

function dataUrlParts(url: string) {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(url)

  if (!match) {
    return null
  }

  return { mimeType: match[1], data: match[2] }
}

function contentItemText(item: Record<string, unknown>) {
  if (typeof item.text === "string") {
    return item.text
  }

  if (typeof item.output_text === "string") {
    return item.output_text
  }

  return ""
}

function contentItemImageUrl(item: Record<string, unknown>) {
  if (typeof item.image_url === "string") {
    return item.image_url
  }

  if (item.image_url && typeof item.image_url === "object") {
    const image = item.image_url as Record<string, unknown>

    if (typeof image.url === "string") {
      return image.url
    }
  }

  if (typeof item.imageUrl === "string") {
    return item.imageUrl
  }

  if (typeof item.file_id === "string") {
    return item.file_id
  }

  return null
}

function contentItemsToChatContent(content: unknown): string | Array<ChatContentPart> {
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  const parts = content
    .map((item): ChatContentPart | null => {
      if (!item || typeof item !== "object") {
        return null
      }

      const value = item as Record<string, unknown>
      const text = contentItemText(value)

      if (text) {
        return { type: "text", text }
      }

      const imageUrl = contentItemImageUrl(value)

      if (imageUrl) {
        return { type: "image_url", image_url: { url: imageUrl } }
      }

      return null
    })
    .filter((part): part is ChatContentPart => Boolean(part))

  if (parts.length === 0) {
    return ""
  }

  if (parts.every((part) => part.type === "text")) {
    return parts.map((part) => part.text).join("\n")
  }

  return parts
}

function contentToText(content: ChatMessage["content"]) {
  if (typeof content === "string") {
    return content
  }

  return (content || [])
    .map((part) => {
      if (part.type === "text") {
        return part.text
      }

      return `[Image: ${part.image_url.url}]`
    })
    .filter(Boolean)
    .join("\n")
}

function outputToText(output: unknown) {
  if (typeof output === "string") {
    return output
  }

  if (Array.isArray(output)) {
    return contentToText(contentItemsToChatContent(output))
  }

  return JSON.stringify(output ?? "")
}

function responsesInputToChatMessages(body: Record<string, unknown>) {
  const messages: Array<ChatMessage> = []

  if (typeof body.instructions === "string" && body.instructions.trim()) {
    messages.push({ role: "system", content: body.instructions })
  }

  const input = body.input

  if (typeof input === "string") {
    messages.push({ role: "user", content: input })
    return messages
  }

  if (!Array.isArray(input)) {
    return messages
  }

  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue
    }

    const value = item as Record<string, unknown>

    if (value.type === "message") {
      const role = typeof value.role === "string" ? value.role : "user"
      messages.push({ role, content: contentItemsToChatContent(value.content) })
      continue
    }

    if (value.type === "function_call") {
      const callId =
        typeof value.call_id === "string" ? value.call_id : functionCallId()
      const name = typeof value.name === "string" ? value.name : "tool"
      const args = typeof value.arguments === "string" ? value.arguments : "{}"

      messages.push({
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: callId,
            type: "function",
            function: { name, arguments: args },
          },
        ],
      })
      continue
    }

    if (
      value.type === "function_call_output" ||
      value.type === "custom_tool_call_output"
    ) {
      const callId =
        typeof value.call_id === "string" ? value.call_id : functionCallId()
      messages.push({
        role: "tool",
        tool_call_id: callId,
        content: outputToText(value.output),
      })
    }
  }

  return messages
}

function responsesToolsToChatTools(tools: unknown): Array<ChatTool> | undefined {
  if (!Array.isArray(tools)) {
    return undefined
  }

  const chatTools = tools
    .map((tool): ChatTool | null => {
      if (!tool || typeof tool !== "object") {
        return null
      }

      const value = tool as Record<string, unknown>

      if (value.type !== "function") {
        return null
      }

      return {
        type: "function",
        function: {
          name: value.name,
          description: value.description,
          parameters: value.parameters || {},
        },
      } satisfies ChatTool
    })
    .filter((tool): tool is ChatTool => Boolean(tool))

  return chatTools.length > 0 ? chatTools : undefined
}

function reasoningEffort(body: Record<string, unknown>) {
  if (typeof body.reasoning_effort === "string") {
    return body.reasoning_effort
  }

  if (typeof body.reasoning === "string") {
    return body.reasoning
  }

  if (body.reasoning && typeof body.reasoning === "object") {
    const reasoning = body.reasoning as Record<string, unknown>

    if (typeof reasoning.effort === "string") {
      return reasoning.effort
    }
  }

  return null
}

function buildOpenRouterChatBody(input: UpstreamRequest, stream: boolean) {
  const chatBody: Record<string, unknown> = {
    model: input.model.upstreamModel,
    messages: responsesInputToChatMessages(input.body),
    stream,
  }
  const tools = responsesToolsToChatTools(input.body.tools)

  if (tools) {
    chatBody.tools = tools
    chatBody.tool_choice = input.body.tool_choice || "auto"
  }

  if (typeof input.body.temperature === "number") {
    chatBody.temperature = input.body.temperature
  }

  if (typeof input.body.max_output_tokens === "number") {
    chatBody.max_tokens = input.body.max_output_tokens
  }

  const effort = reasoningEffort(input.body)

  if (effort && input.model.reasoningCapability?.kind === "effort") {
    if (input.model.supportedParameters?.includes("reasoning_effort")) {
      chatBody.reasoning_effort = effort
    } else if (input.model.supportedParameters?.includes("reasoning")) {
      chatBody.reasoning = { effort }
    }
  }

  return chatBody
}

function responseCompletedEventWithUsage(
  id: string,
  model: string,
  output: Array<Record<string, unknown>>,
  usage?: unknown
) {
  const event = responseCompletedEvent(id, model, output)

  if (usage) {
    ;(event.response as Record<string, unknown>).usage = usage
  }

  return event
}

function tokenCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function responseCreatedEvent(id: string, model: string) {
  return {
    type: "response.created",
    response: {
      id,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "in_progress",
      model,
      output: [],
    },
  }
}

function responseCompletedEvent(
  id: string,
  model: string,
  output: Array<Record<string, unknown>>
) {
  return {
    type: "response.completed",
    response: {
      id,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "completed",
      model,
      output,
    },
  }
}

function encodeSse(event: Record<string, unknown>) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

function messageOutputItem(itemId: string, text: string) {
  return {
    id: itemId,
    type: "message",
    status: "completed",
    role: "assistant",
    content: [{ type: "output_text", text, annotations: [] }],
  }
}

function functionCallOutputItem(call: ChatToolCall) {
  return {
    id: outputItemId(),
    type: "function_call",
    status: "completed",
    name: call.function?.name || "tool",
    arguments: call.function?.arguments || "{}",
    call_id: call.id,
  }
}

function textFromOutputItem(item: Record<string, unknown>) {
  const content = item.content

  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return ""
      }

      const value = part as Record<string, unknown>
      return typeof value.text === "string" ? value.text : ""
    })
    .filter(Boolean)
    .join("\n")
}

function responsesOutput(
  input: UpstreamRequest,
  id: string,
  output: Array<Record<string, unknown>>,
  usage?: unknown
) {
  if (input.body.stream === false) {
    return json(
      responseCompletedEventWithUsage(id, input.model.id, output, usage).response
    )
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(encodeSse(event)))
      }

      send(responseCreatedEvent(id, input.model.id))

      output.forEach((item, index) => {
        send({
          type: "response.output_item.added",
          output_index: index,
          item: { ...item, status: "in_progress" },
        })

        if (item.type === "message") {
          const text = textFromOutputItem(item)

          send({
            type: "response.content_part.added",
            item_id: item.id,
            output_index: index,
            content_index: 0,
            part: { type: "output_text", text: "", annotations: [] },
          })
          send({
            type: "response.output_text.delta",
            item_id: item.id,
            output_index: index,
            content_index: 0,
            delta: text,
          })
          send({
            type: "response.output_text.done",
            item_id: item.id,
            output_index: index,
            content_index: 0,
            text,
          })
          send({
            type: "response.content_part.done",
            item_id: item.id,
            output_index: index,
            content_index: 0,
            part: { type: "output_text", text, annotations: [] },
          })
        }

        send({
          type: "response.output_item.done",
          output_index: index,
          item,
        })
      })

      send(responseCompletedEventWithUsage(id, input.model.id, output, usage))
      controller.enqueue(encoder.encode("data: [DONE]\n\n"))
      controller.close()
    },
  })

  return new Response(stream, { headers: sseHeaders() })
}

async function openRouterKey(input: UpstreamRequest) {
  return (
    (await getStoredOpenRouterKey()) ||
    getEnv("OPENROUTER_API_KEY") ||
    getBearerToken(input.request)
  )
}

async function openCodeZenKey(input: UpstreamRequest) {
  return (
    (await getStoredOpenCodeZenKey()) ||
    getEnv("OPENCODE_ZEN_API_KEY") ||
    getBearerToken(input.request)
  )
}

function missingOpenRouterKeyResponse() {
  return json(
    {
      error: {
        message:
          "Add an OpenRouter provider key, set OPENROUTER_API_KEY, or pass a Bearer token to use OpenRouter models.",
        type: "missing_openrouter_key",
      },
    },
    401
  )
}

function missingOpenCodeZenKeyResponse() {
  return json(
    {
      error: {
        message:
          "Add an OpenCode Zen provider key, set OPENCODE_ZEN_API_KEY, or pass a Bearer token to use OpenCode Zen models.",
        type: "missing_opencode_zen_key",
      },
    },
    401
  )
}

async function getOpenAIBearer() {
  return getOpenAIKey() || (await getActiveAccessToken())
}

async function forwardJson(
  url: string,
  bearer: string,
  input: UpstreamRequest
) {
  const upstreamBody = {
    ...input.body,
    model: input.model.upstreamModel,
  }

  const response = await fetch(url, {
    method: "POST",
    headers: cloneHeaders(input.request, bearer),
    body: JSON.stringify(upstreamBody),
  })

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

export async function forwardChatCompletions(input: UpstreamRequest) {
  if (!input.model.supportsChatCompletions) {
    return json(
      {
        error: {
          message: `${input.model.id} does not support /v1/chat/completions through this proxy route`,
          type: "unsupported_model_route",
        },
      },
      400
    )
  }

  if (input.model.provider === "openrouter") {
    const key = await openRouterKey(input)

    if (!key) {
      return missingOpenRouterKeyResponse()
    }

    return forwardJson(
      "https://openrouter.ai/api/v1/chat/completions",
      key,
      input
    )
  }

  if (input.model.provider === "opencode-zen") {
    const key = await openCodeZenKey(input)

    if (!key) {
      return missingOpenCodeZenKeyResponse()
    }

    return forwardJson(
      "https://opencode.ai/zen/v1/chat/completions",
      key,
      input
    )
  }

  const key = await getOpenAIBearer()

  if (!key) {
    return json(
      {
        error: {
          message:
            "Set CMM_OPENAI_KEYS or OPENAI_API_KEY to use OpenAI pool models.",
          type: "missing_openai_key",
        },
      },
      401
    )
  }

  return forwardJson("https://api.openai.com/v1/chat/completions", key, input)
}

async function forwardOpenRouterResponses(input: UpstreamRequest) {
  const key = await openRouterKey(input)

  if (!key) {
    return missingOpenRouterKeyResponse()
  }

  const shouldStream = input.body.stream !== false
  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: cloneHeaders(input.request, key),
      body: JSON.stringify(buildOpenRouterChatBody(input, shouldStream)),
    }
  )

  if (!response.ok || !shouldStream) {
    if (!response.ok) {
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }

    const data = (await response.json()) as OpenRouterChatResponse
    const id = responseId()
    const message = data.choices?.[0]?.message
    const output = message?.tool_calls?.length
      ? message.tool_calls.map(functionCallOutputItem)
      : [messageOutputItem(outputItemId(), message?.content || "")]

    return json(responseCompletedEvent(id, input.model.id, output).response)
  }

  if (!response.body) {
    return json(
      { error: { message: "OpenRouter returned an empty stream." } },
      502
    )
  }

  const id = responseId()
  const itemId = outputItemId()
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  let buffer = ""
  let emittedMessage = false
  let text = ""
  const toolCalls = new Map<
    number,
    { id: string; function: { name: string; arguments: string } }
  >()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(encodeSse(event)))
      }
      const ensureMessage = () => {
        if (emittedMessage) {
          return
        }

        emittedMessage = true
        send({
          type: "response.output_item.added",
          output_index: 0,
          item: {
            id: itemId,
            type: "message",
            status: "in_progress",
            role: "assistant",
            content: [],
          },
        })
        send({
          type: "response.content_part.added",
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        })
      }

      send(responseCreatedEvent(id, input.model.id))

      try {
        for (;;) {
          const { done, value } = await reader.read()

          if (done) {
            break
          }

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""

          for (const rawLine of lines) {
            const line = rawLine.trim()

            if (!line.startsWith("data:")) {
              continue
            }

            const payload = line.slice("data:".length).trim()

            if (!payload || payload === "[DONE]") {
              continue
            }

            const chunk = JSON.parse(payload) as OpenRouterChatChunk
            const delta = chunk.choices?.[0]?.delta

            if (delta?.content) {
              ensureMessage()
              text += delta.content
              send({
                type: "response.output_text.delta",
                item_id: itemId,
                output_index: 0,
                content_index: 0,
                delta: delta.content,
              })
            }

            for (const call of delta?.tool_calls || []) {
              const index = call.index ?? 0
              const current = toolCalls.get(index) || {
                id: call.id || functionCallId(),
                function: { name: "tool", arguments: "" },
              }

              current.id = call.id || current.id
              current.function.name =
                call.function?.name || current.function.name
              current.function.arguments += call.function?.arguments || ""
              toolCalls.set(index, current)
            }
          }
        }

        const output =
          toolCalls.size > 0
            ? [...toolCalls.values()].map((call) =>
                functionCallOutputItem({ id: call.id, function: call.function })
              )
            : [messageOutputItem(itemId, text)]

        if (emittedMessage) {
          send({
            type: "response.output_text.done",
            item_id: itemId,
            output_index: 0,
            content_index: 0,
            text,
          })
          send({
            type: "response.content_part.done",
            item_id: itemId,
            output_index: 0,
            content_index: 0,
            part: { type: "output_text", text, annotations: [] },
          })
          send({
            type: "response.output_item.done",
            output_index: 0,
            item: output[0],
          })
        } else {
          output.forEach((item, index) => {
            send({
              type: "response.output_item.done",
              output_index: index,
              item,
            })
          })
        }

        send(responseCompletedEvent(id, input.model.id, output))
        controller.enqueue(encoder.encode("data: [DONE]\n\n"))
        controller.close()
      } catch (error) {
        controller.error(error)
      } finally {
        reader.releaseLock()
      }
    },
  })

  return new Response(stream, { headers: sseHeaders() })
}

function chatUsageToResponseUsage(usage: unknown) {
  if (!usage || typeof usage !== "object") {
    return undefined
  }

  const data = usage as Record<string, unknown>
  const inputTokens = tokenCount(data.prompt_tokens)
  const outputTokens = tokenCount(data.completion_tokens)

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: tokenCount(data.total_tokens) || inputTokens + outputTokens,
  }
}

async function forwardChatCompatibleResponses(
  input: UpstreamRequest,
  url: string,
  key: string,
  emptyStreamMessage: string
) {
  const shouldStream = input.body.stream !== false
  const response = await fetch(url, {
    method: "POST",
    headers: cloneHeaders(input.request, key),
    body: JSON.stringify(buildOpenRouterChatBody(input, shouldStream)),
  })

  if (!response.ok || !shouldStream) {
    if (!response.ok) {
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }

    const data = (await response.json()) as OpenRouterChatResponse
    const id = responseId()
    const message = data.choices?.[0]?.message
    const output = message?.tool_calls?.length
      ? message.tool_calls.map(functionCallOutputItem)
      : [messageOutputItem(outputItemId(), message?.content || "")]

    return json(
      responseCompletedEventWithUsage(
        id,
        input.model.id,
        output,
        chatUsageToResponseUsage(data.usage)
      ).response
    )
  }

  if (!response.body) {
    return json({ error: { message: emptyStreamMessage } }, 502)
  }

  const id = responseId()
  const itemId = outputItemId()
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  let buffer = ""
  let emittedMessage = false
  let text = ""
  let usage: unknown
  const toolCalls = new Map<
    number,
    { id: string; function: { name: string; arguments: string } }
  >()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(encodeSse(event)))
      }
      const ensureMessage = () => {
        if (emittedMessage) {
          return
        }

        emittedMessage = true
        send({
          type: "response.output_item.added",
          output_index: 0,
          item: {
            id: itemId,
            type: "message",
            status: "in_progress",
            role: "assistant",
            content: [],
          },
        })
        send({
          type: "response.content_part.added",
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        })
      }

      send(responseCreatedEvent(id, input.model.id))

      try {
        for (;;) {
          const { done, value } = await reader.read()

          if (done) {
            break
          }

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""

          for (const rawLine of lines) {
            const line = rawLine.trim()

            if (!line.startsWith("data:")) {
              continue
            }

            const payload = line.slice("data:".length).trim()

            if (!payload || payload === "[DONE]") {
              continue
            }

            const chunk = JSON.parse(payload) as OpenRouterChatChunk & {
              usage?: unknown
            }
            const delta = chunk.choices?.[0]?.delta

            usage = chunk.usage || usage

            if (delta?.content) {
              ensureMessage()
              text += delta.content
              send({
                type: "response.output_text.delta",
                item_id: itemId,
                output_index: 0,
                content_index: 0,
                delta: delta.content,
              })
            }

            for (const call of delta?.tool_calls || []) {
              const index = call.index ?? 0
              const current = toolCalls.get(index) || {
                id: call.id || functionCallId(),
                function: { name: "tool", arguments: "" },
              }

              current.id = call.id || current.id
              current.function.name =
                call.function?.name || current.function.name
              current.function.arguments += call.function?.arguments || ""
              toolCalls.set(index, current)
            }
          }
        }

        const output =
          toolCalls.size > 0
            ? [...toolCalls.values()].map((call) =>
                functionCallOutputItem({ id: call.id, function: call.function })
              )
            : [messageOutputItem(itemId, text)]

        if (emittedMessage) {
          send({
            type: "response.output_text.done",
            item_id: itemId,
            output_index: 0,
            content_index: 0,
            text,
          })
          send({
            type: "response.content_part.done",
            item_id: itemId,
            output_index: 0,
            content_index: 0,
            part: { type: "output_text", text, annotations: [] },
          })
          send({
            type: "response.output_item.done",
            output_index: 0,
            item: output[0],
          })
        } else {
          output.forEach((item, index) => {
            send({
              type: "response.output_item.done",
              output_index: index,
              item,
            })
          })
        }

        send(
          responseCompletedEventWithUsage(
            id,
            input.model.id,
            output,
            chatUsageToResponseUsage(usage)
          )
        )
        controller.enqueue(encoder.encode("data: [DONE]\n\n"))
        controller.close()
      } catch (error) {
        controller.error(error)
      } finally {
        reader.releaseLock()
      }
    },
  })

  return new Response(stream, { headers: sseHeaders() })
}

function anthropicContentText(content: AnthropicMessageResponse["content"]) {
  return (content || [])
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
}

function anthropicOutput(content: AnthropicMessageResponse["content"]) {
  const toolUses = (content || []).filter((item) => item.type === "tool_use")

  if (toolUses.length > 0) {
    return toolUses.map((item) =>
      functionCallOutputItem({
        id: item.id || functionCallId(),
        function: {
          name: item.name || "tool",
          arguments: JSON.stringify(item.input || {}),
        },
      })
    )
  }

  return [messageOutputItem(outputItemId(), anthropicContentText(content))]
}

function anthropicUsageToResponseUsage(usage: AnthropicMessageResponse["usage"]) {
  if (!usage) {
    return undefined
  }

  const inputTokens = tokenCount(usage.input_tokens)
  const outputTokens = tokenCount(usage.output_tokens)

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    input_tokens_details: {
      cached_tokens: tokenCount(usage.cache_read_input_tokens),
    },
  }
}

function buildAnthropicBody(input: UpstreamRequest) {
  const messages = responsesInputToChatMessages(input.body)
  const system = contentToText(
    messages.find((message) => message.role === "system")?.content
  )
  const tools = responsesToolsToChatTools(input.body.tools)?.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }))

  return {
    model: input.model.upstreamModel,
    ...(system ? { system } : {}),
    messages: messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: chatContentToAnthropicBlocks(message.content),
      })),
    max_tokens:
      typeof input.body.max_output_tokens === "number"
        ? input.body.max_output_tokens
        : input.model.outputLimit || 4096,
    ...(typeof input.body.temperature === "number"
      ? { temperature: input.body.temperature }
      : {}),
    ...(tools?.length ? { tools } : {}),
  }
}

async function forwardOpenCodeZenMessages(input: UpstreamRequest, key: string) {
  const response = await fetch("https://opencode.ai/zen/v1/messages", {
    method: "POST",
    headers: cloneHeaders(input.request, key),
    body: JSON.stringify(buildAnthropicBody(input)),
  })

  if (!response.ok) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  const data = (await response.json()) as AnthropicMessageResponse
  const id = responseId()
  const output = anthropicOutput(data.content)

  return responsesOutput(
    input,
    id,
    output,
    anthropicUsageToResponseUsage(data.usage)
  )
}

function chatContentToAnthropicBlocks(
  content: ChatMessage["content"]
): string | Array<AnthropicContentBlock> {
  if (typeof content === "string") {
    return content
  }

  const blocks = (content || [])
    .map((part): AnthropicContentBlock | null => {
      if (part.type === "text") {
        return { type: "text", text: part.text }
      }

      const data = dataUrlParts(part.image_url.url)

      if (data) {
        return {
          type: "image",
          source: {
            type: "base64",
            media_type: data.mimeType,
            data: data.data,
          },
        }
      }

      return {
        type: "image",
        source: { type: "url", url: part.image_url.url },
      }
    })
    .filter((part): part is AnthropicContentBlock => Boolean(part))

  return blocks.length > 0 ? blocks : ""
}

function chatContentToGeminiParts(content: ChatMessage["content"]) {
  if (typeof content === "string") {
    return [{ text: content }]
  }

  const parts = (content || [])
    .map((part): GeminiPart | null => {
      if (part.type === "text") {
        return { text: part.text }
      }

      const data = dataUrlParts(part.image_url.url)

      if (data) {
        return { inlineData: data }
      }

      return {
        fileData: {
          mimeType: "image/*",
          fileUri: part.image_url.url,
        },
      }
    })
    .filter((part): part is GeminiPart => Boolean(part))

  return parts.length > 0 ? parts : [{ text: "" }]
}

function buildGeminiBody(input: UpstreamRequest) {
  const messages = responsesInputToChatMessages(input.body)
  const system = contentToText(
    messages.find((message) => message.role === "system")?.content
  )

  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: chatContentToGeminiParts(message.content),
      })),
    generationConfig: {
      ...(typeof input.body.temperature === "number"
        ? { temperature: input.body.temperature }
        : {}),
      ...(typeof input.body.max_output_tokens === "number"
        ? { maxOutputTokens: input.body.max_output_tokens }
        : {}),
    },
  }
}

function geminiOutput(data: GeminiResponse) {
  const parts = data.candidates?.[0]?.content?.parts || []
  const functionCalls = parts.filter((part) => part.functionCall)

  if (functionCalls.length > 0) {
    return functionCalls.map((part) =>
      functionCallOutputItem({
        id: functionCallId(),
        function: {
          name: part.functionCall?.name || "tool",
          arguments: JSON.stringify(part.functionCall?.args || {}),
        },
      })
    )
  }

  return [
    messageOutputItem(
      outputItemId(),
      parts.map((part) => part.text || "").filter(Boolean).join("\n")
    ),
  ]
}

function geminiUsageToResponseUsage(usage: GeminiResponse["usageMetadata"]) {
  if (!usage) {
    return undefined
  }

  const inputTokens = tokenCount(usage.promptTokenCount)
  const outputTokens =
    tokenCount(usage.candidatesTokenCount) ||
    Math.max(0, tokenCount(usage.totalTokenCount) - inputTokens)

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: tokenCount(usage.totalTokenCount) || inputTokens + outputTokens,
    input_tokens_details: {
      cached_tokens: tokenCount(usage.cachedContentTokenCount),
    },
  }
}

async function forwardOpenCodeZenGemini(input: UpstreamRequest, key: string) {
  const response = await fetch(
    `https://opencode.ai/zen/v1/models/${input.model.upstreamModel}:generateContent`,
    {
      method: "POST",
      headers: cloneGoogleStyleHeaders(input.request, key),
      body: JSON.stringify(buildGeminiBody(input)),
    }
  )

  if (!response.ok) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  const data = (await response.json()) as GeminiResponse
  const id = responseId()
  const output = geminiOutput(data)

  return responsesOutput(
    input,
    id,
    output,
    geminiUsageToResponseUsage(data.usageMetadata)
  )
}

async function forwardOpenCodeZenResponses(input: UpstreamRequest) {
  const key = await openCodeZenKey(input)

  if (!key) {
    return missingOpenCodeZenKeyResponse()
  }

  const family = openCodeZenModelFamily(input.model.id)

  if (family === "responses") {
    return forwardJson("https://opencode.ai/zen/v1/responses", key, input)
  }

  if (family === "messages") {
    return forwardOpenCodeZenMessages(input, key)
  }

  if (family === "gemini") {
    return forwardOpenCodeZenGemini(input, key)
  }

  return forwardChatCompatibleResponses(
    input,
    "https://opencode.ai/zen/v1/chat/completions",
    key,
    "OpenCode Zen returned an empty stream."
  )
}

export async function forwardResponses(input: UpstreamRequest) {
  if (!input.model.supportsResponses) {
    return json(
      {
        error: {
          message: `${input.model.id} is exposed for chat completions, not Codex Responses. Use /v1/chat/completions or enable a Responses-capable model.`,
          type: "unsupported_model_route",
        },
      },
      400
    )
  }

  if (input.model.provider === "openrouter") {
    return forwardOpenRouterResponses(input)
  }

  if (input.model.provider === "opencode-zen") {
    return forwardOpenCodeZenResponses(input)
  }

  const accountToken = await getActiveAccessToken()
  const key = accountToken || getOpenAIKey()

  if (!key) {
    return json(
      {
        error: {
          message:
            "Connect a ChatGPT account or set CMM_OPENAI_KEYS/OPENAI_API_KEY to use Codex/OpenAI Responses models.",
          type: "missing_openai_key",
        },
      },
      401
    )
  }

  if (accountToken) {
    return forwardJson(
      "https://chatgpt.com/backend-api/codex/responses",
      key,
      input
    )
  }

  return forwardJson("https://api.openai.com/v1/responses", key, input)
}

export async function forwardCodexAutoReviewResponses(
  request: Request,
  body: Record<string, unknown>
) {
  const account = await getActiveAccount()
  const accountToken = account ? await getActiveAccessToken() : null

  if (!account || !accountToken) {
    return json(
      {
        error: {
          message: "Connect a ChatGPT account to use Codex auto-review.",
          type: "missing_chatgpt_account",
        },
      },
      401
    )
  }

  let response: Response
  try {
    response = await fetch("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: cloneCodexResponsesHeaders(
        request,
        accountToken,
        account.chatgptAccountId
      ),
      body: JSON.stringify(normalizeCodexResponsesPayload(body)),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "fetch failed"
    return json(
      {
        error: {
          message: `Codex auto-review upstream request failed: ${message}`,
          type: "upstream_fetch_failed",
        },
      },
      502
    )
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

export async function forwardCodexControlRequest(request: Request, path: string) {
  const account = await getActiveAccount()
  const token = account ? await getActiveAccessToken() : null

  if (!account || !token) {
    return json(
      {
        error: {
          message: "Connect a ChatGPT account to use Codex control routes.",
          type: "missing_chatgpt_account",
        },
      },
      401
    )
  }

  const sourceUrl = new URL(request.url)
  const normalizedPath = path.replace(/^\/+|\/+$/g, "")
  const upstreamPath = normalizedPath.startsWith("wham/")
    ? normalizedPath
    : `codex/${normalizedPath}`
  const upstreamUrl = new URL(
    `https://chatgpt.com/backend-api/${upstreamPath}`
  )
  upstreamUrl.search = sourceUrl.search

  const method = request.method.toUpperCase()
  const hasBody = method !== "GET" && method !== "HEAD"
  const body = hasBody ? await request.arrayBuffer() : undefined
  const response = await fetch(upstreamUrl, {
    method,
    headers: cloneCodexControlHeaders(
      request,
      token,
      account.chatgptAccountId,
      hasBody
    ),
    body: body && body.byteLength > 0 ? body : undefined,
  })

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: codexControlResponseHeaders(response.headers),
  })
}
