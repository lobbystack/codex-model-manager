import { createFileRoute } from "@tanstack/react-router"

import { apiJson, apiOptions } from "@/server/api/json"
import { getUsageCostSeries } from "@/server/usage/store"

function parseYear(url: string) {
  const value = Number(new URL(url).searchParams.get("year"))

  if (!Number.isInteger(value) || value < 2000 || value > 2100) {
    return new Date().getFullYear()
  }

  return value
}

function parseMonth(url: string) {
  const value = Number(new URL(url).searchParams.get("month"))

  if (!Number.isInteger(value) || value < 1 || value > 12) {
    return new Date().getMonth() + 1
  }

  return value
}

function parseModels(url: string) {
  const value = new URL(url).searchParams.get("models")

  if (!value) {
    return undefined
  }

  const models = value
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean)

  return models.length > 0 ? models : undefined
}

export const Route = createFileRoute("/api/usage/cost-series")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        apiJson(
          await getUsageCostSeries({
            year: parseYear(request.url),
            month: parseMonth(request.url),
            models: parseModels(request.url),
            costKind: "estimated",
          })
        ),
      OPTIONS: () => apiOptions(),
    },
  },
})
