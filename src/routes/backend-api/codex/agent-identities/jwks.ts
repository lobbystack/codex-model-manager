import { createFileRoute } from "@tanstack/react-router"

import { optionsResponse } from "@/proxy/handlers"
import { forwardCodexControlRequest } from "@/proxy/upstreams"

export const Route = createFileRoute("/backend-api/codex/agent-identities/jwks")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        forwardCodexControlRequest(request, "agent-identities/jwks"),
      OPTIONS: () => optionsResponse(),
    },
  },
})
