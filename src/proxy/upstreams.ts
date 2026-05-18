import type { ManagedModel } from "./model-registry"
import { getOpenRouterKey as getStoredOpenRouterKey } from "@/server/accounts/store"
import { getActiveAccessToken } from "@/server/oauth/service"

type UpstreamRequest = {
  request: Request
  model: ManagedModel
  body: Record<string, unknown>
}

type ChatMessage = {
  role: string
  content?: string
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
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: Array<ChatToolCall>
    }
  }>
}

let openAIKeyIndex = 0

function getEnv(name: string) {
  return process.env[name]
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status })
}

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
    .filter(Boolean)

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

function contentItemsText(content: unknown) {
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .map((item) => {
      if (!item || typeof item !== "object") {
        return ""
      }

      const value = item as Record<string, unknown>

      if (typeof value.text === "string") {
        return value.text
      }

      if (typeof value.image_url === "string") {
        return `[Image: ${value.image_url}]`
      }

      return ""
    })
    .filter(Boolean)
    .join("\n")
}

function outputToText(output: unknown) {
  if (typeof output === "string") {
    return output
  }

  if (Array.isArray(output)) {
    return contentItemsText(output)
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
      messages.push({ role, content: contentItemsText(value.content) })
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

function responsesToolsToChatTools(tools: unknown) {
  if (!Array.isArray(tools)) {
    return undefined
  }

  const chatTools = tools
    .map((tool) => {
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
      }
    })
    .filter(Boolean)

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

  if (effort) {
    if (input.model.supportedParameters?.includes("reasoning_effort")) {
      chatBody.reasoning_effort = effort
    } else if (input.model.supportedParameters?.includes("reasoning")) {
      chatBody.reasoning = { effort }
    }
  }

  return chatBody
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

async function openRouterKey(input: UpstreamRequest) {
  return (
    (await getStoredOpenRouterKey()) ||
    getEnv("OPENROUTER_API_KEY") ||
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
