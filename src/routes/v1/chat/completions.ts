import { createFileRoute } from "@tanstack/react-router"

import { optionsResponse, routeProxyRequest } from "@/proxy/handlers"

export const Route = createFileRoute("/v1/chat/completions")({
  server: {
    handlers: {
      POST: async ({ request }) => routeProxyRequest(request, "chat"),
      OPTIONS: () => optionsResponse(),
    },
  },
})
