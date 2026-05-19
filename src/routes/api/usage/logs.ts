import { createFileRoute } from "@tanstack/react-router"

import type { UsageSummary } from "@/server/usage/types"
import { apiJson, apiOptions } from "@/server/api/json"
import { getUsageLogs } from "@/server/usage/store"

function parseRange(url: string): UsageSummary["range"] {
  const value = new URL(url).searchParams.get("range")

  if (value === "7d" || value === "30d" || value === "all") {
    return value
  }

  return "today"
}

function parseLimit(url: string) {
  const value = Number(new URL(url).searchParams.get("limit") || "25")

  if (!Number.isInteger(value) || value < 1) {
    return 25
  }

  return Math.min(value, 200)
}

function parseOffset(url: string) {
  const value = Number(new URL(url).searchParams.get("offset") || "0")

  if (!Number.isInteger(value) || value < 0) {
    return 0
  }

  return value
}

export const Route = createFileRoute("/api/usage/logs")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        apiJson(
          await getUsageLogs(
            parseRange(request.url),
            parseLimit(request.url),
            parseOffset(request.url)
          )
        ),
      OPTIONS: () => apiOptions(),
    },
  },
})
