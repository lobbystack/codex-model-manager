import { createFileRoute } from "@tanstack/react-router"

import type { UsageSummary } from "@/server/usage/types"
import { apiJson, apiOptions } from "@/server/api/json"
import { getUsageSummary } from "@/server/usage/store"

function parseRange(url: string): UsageSummary["range"] {
  const value = new URL(url).searchParams.get("range")

  if (value === "7d" || value === "30d" || value === "all") {
    return value
  }

  return "today"
}

export const Route = createFileRoute("/api/usage")({
  server: {
    handlers: {
      GET: async ({ request }) => apiJson(await getUsageSummary(parseRange(request.url))),
      OPTIONS: () => apiOptions(),
    },
  },
})
