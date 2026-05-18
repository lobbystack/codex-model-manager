import { createFileRoute } from "@tanstack/react-router"

import { optionsResponse } from "@/proxy/handlers"
import { forwardCodexControlRequest } from "@/proxy/upstreams"

export const Route = createFileRoute("/backend-api/codex/thread/goal/clear")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        forwardCodexControlRequest(request, "thread/goal/clear"),
      OPTIONS: () => optionsResponse(),
    },
  },
})
