import { createFileRoute } from "@tanstack/react-router"

import { optionsResponse } from "@/proxy/handlers"
import { forwardCodexControlRequest } from "@/proxy/upstreams"

export const Route = createFileRoute("/backend-api/codex/responses/compact")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        forwardCodexControlRequest(request, "responses/compact"),
      OPTIONS: () => optionsResponse(),
    },
  },
})
