import { createFileRoute } from "@tanstack/react-router"

import { optionsResponse } from "@/proxy/handlers"
import { forwardCodexControlRequest } from "@/proxy/upstreams"

export const Route = createFileRoute("/backend-api/codex/thread/goal/get")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        forwardCodexControlRequest(request, "thread/goal/get"),
      POST: async ({ request }) =>
        forwardCodexControlRequest(request, "thread/goal/get"),
      OPTIONS: () => optionsResponse(),
    },
  },
})
