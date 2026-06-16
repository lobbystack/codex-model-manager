import type { StoredAccount } from "@/server/accounts/types"
import {
  MAX_SELECTION_ATTEMPTS,
  markFailureAndShouldRetry,
  selectAccountForRequest,
} from "@/server/balancer"
import {
  extractErrorCode,
  extractUpstreamError,
} from "@/server/balancer/classify"
import { getAccessTokenForAccount } from "@/server/oauth/service"

function json(data: unknown, status = 200) {
  return Response.json(data, { status })
}

function isEventStream(response: Response) {
  const contentType = response.headers.get("content-type") || ""
  return contentType.includes("text/event-stream")
}

function parseSseEventBlock(block: string) {
  const dataLines = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())

  if (dataLines.length === 0) {
    return null
  }

  const payloadText = dataLines.join("\n")

  if (!payloadText || payloadText === "[DONE]") {
    return null
  }

  try {
    return JSON.parse(payloadText) as unknown
  } catch {
    return null
  }
}

async function inspectResponseForFailover(response: Response) {
  if (response.status === 429) {
    let payload: unknown = null

    try {
      payload = await response.clone().json()
    } catch {
      payload = {
        error: {
          code: "rate_limit_exceeded",
          message: "Rate limit exceeded",
        },
      }
    }

    return {
      shouldFailover: true,
      payload,
      response,
    }
  }

  if (!isEventStream(response)) {
    if (response.ok) {
      return {
        shouldFailover: false,
        payload: null,
        response,
      }
    }

    let payload: unknown = null

    try {
      payload = await response.clone().json()
    } catch {
      payload = {
        error: {
          code: `http_${response.status}`,
          message: response.statusText || "Upstream request failed",
        },
      }
    }

    return {
      shouldFailover: true,
      payload,
      response,
    }
  }

  const reader = response.body?.getReader()

  if (!reader) {
    return {
      shouldFailover: false,
      payload: null,
      response,
    }
  }

  const decoder = new TextDecoder()
  const chunks: Array<Uint8Array> = []
  let buffer = ""
  let finished = false

  while (!finished) {
    const { done, value } = await reader.read()

    if (done) {
      finished = true
      break
    }

    chunks.push(value)
    buffer += decoder.decode(value, { stream: true })

    if (!buffer.includes("\n\n")) {
      continue
    }

    const firstBlock = buffer.split("\n\n")[0]
    const payload = parseSseEventBlock(firstBlock)

    if (payload) {
      const errorCode = extractErrorCode(payload, response.status)
      const isFailureEvent =
        errorCode === "rate_limit_exceeded" ||
        errorCode === "usage_limit_reached" ||
        (typeof payload === "object" &&
          "response" in payload &&
          (payload as { response?: { status?: string } }).response?.status ===
            "failed")

      if (isFailureEvent) {
        await reader.cancel()
        return {
          shouldFailover: true,
          payload,
          response,
        }
      }
    }

    finished = true
  }

  const combinedStream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }

      void (async () => {
        try {
          let next = await reader.read()

          while (!next.done) {
            controller.enqueue(next.value)
            next = await reader.read()
          }

          controller.close()
        } catch {
          controller.close()
        }
      })()
    },
  })

  return {
    shouldFailover: false,
    payload: null,
    response: new Response(combinedStream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
  }
}

export async function forwardWithChatGptAccountFailover(
  buildRequest: (account: StoredAccount, token: string) => Promise<Response>,
  options: { maxAttempts?: number } = {}
) {
  const maxAttempts = options.maxAttempts ?? MAX_SELECTION_ATTEMPTS
  const triedAccountIds = new Set<string>()
  let lastResponse: Response | null = null
  let lastErrorMessage: string | null = null

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const selection = await selectAccountForRequest(triedAccountIds)

    if (!selection.account) {
      if (lastResponse) {
        return lastResponse
      }

      return json(
        {
          error: {
            message: selection.errorMessage || "No available ChatGPT accounts.",
            type: "no_accounts",
          },
        },
        503
      )
    }

    const account = selection.account
    triedAccountIds.add(account.id)

    const token = await getAccessTokenForAccount(account)

    if (!token) {
      triedAccountIds.add(account.id)
      continue
    }

    let response: Response

    try {
      response = await buildRequest(account, token)
    } catch (error) {
      const message = error instanceof Error ? error.message : "fetch failed"
      lastErrorMessage = message

      if (attempt < maxAttempts - 1) {
        continue
      }

      return json(
        {
          error: {
            message: `ChatGPT upstream request failed: ${message}`,
            type: "upstream_fetch_failed",
          },
        },
        502
      )
    }

    const inspection = await inspectResponseForFailover(response)
    lastResponse = inspection.response

    if (!inspection.shouldFailover) {
      return inspection.response
    }

    const payload = inspection.payload
    const httpStatus = inspection.response.status
    const candidatesRemaining = maxAttempts - attempt - 1
    const retry = await markFailureAndShouldRetry({
      accountId: account.id,
      payload,
      httpStatus,
      phase: "connect",
      candidatesRemaining,
    })

    if (!retry.shouldRetry) {
      if (payload) {
        const error = extractUpstreamError(payload)
        const errorCode = extractErrorCode(payload, httpStatus)
        return json(
          {
            error: {
              code: errorCode,
              message: error.message || "Upstream request failed",
              type: errorCode,
            },
          },
          httpStatus >= 400 ? httpStatus : 429
        )
      }

      return inspection.response
    }
  }

  if (lastResponse) {
    return lastResponse
  }

  return json(
    {
      error: {
        message: lastErrorMessage || "No available ChatGPT accounts.",
        type: "no_accounts",
      },
    },
    503
  )
}
