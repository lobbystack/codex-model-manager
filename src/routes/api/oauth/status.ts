import { createFileRoute } from "@tanstack/react-router"

import { apiJson, apiOptions } from "@/server/api/json"
import { getOAuthStatus } from "@/server/oauth/service"

export const Route = createFileRoute("/api/oauth/status")({
  server: {
    handlers: {
      GET: () => apiJson(getOAuthStatus()),
      OPTIONS: () => apiOptions(),
    },
  },
})
