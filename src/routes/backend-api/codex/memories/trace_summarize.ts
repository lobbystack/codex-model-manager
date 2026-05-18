import { createFileRoute } from "@tanstack/react-router"

import { optionsResponse } from "@/proxy/handlers"
import { forwardCodexControlRequest } from "@/proxy/upstreams"

export const Route = createFileRoute("/backend-api/codex/memories/trace_summarize")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        forwardCodexControlRequest(request, "memories/trace_summarize"),
      OPTIONS: () => optionsResponse(),
    },
  },
})
