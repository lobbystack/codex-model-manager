import { createFileRoute } from "@tanstack/react-router"

import { optionsResponse } from "@/proxy/handlers"
import { forwardCodexControlRequest } from "@/proxy/upstreams"

export const Route = createFileRoute("/backend-api/wham/agent-identities/jwks")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        forwardCodexControlRequest(request, "wham/agent-identities/jwks"),
      OPTIONS: () => optionsResponse(),
    },
  },
})
