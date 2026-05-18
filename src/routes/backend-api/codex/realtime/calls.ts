import { createFileRoute } from "@tanstack/react-router"

import { optionsResponse } from "@/proxy/handlers"
import { forwardCodexControlRequest } from "@/proxy/upstreams"

export const Route = createFileRoute("/backend-api/codex/realtime/calls")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        forwardCodexControlRequest(request, "realtime/calls"),
      OPTIONS: () => optionsResponse(),
    },
  },
})
