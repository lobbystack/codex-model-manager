import { createFileRoute } from "@tanstack/react-router"

import { optionsResponse, routeProxyRequest } from "@/proxy/handlers"

export const Route = createFileRoute("/backend-api/codex/responses")({
  server: {
    handlers: {
      POST: async ({ request }) => routeProxyRequest(request, "responses"),
      OPTIONS: () => optionsResponse(),
    },
  },
})
