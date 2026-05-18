import { createFileRoute } from "@tanstack/react-router"

import { optionsResponse, routeProxyRequest } from "@/proxy/handlers"

export const Route = createFileRoute("/v1/responses")({
  server: {
    handlers: {
      POST: async ({ request }) => routeProxyRequest(request, "responses"),
      OPTIONS: () => optionsResponse(),
    },
  },
})
