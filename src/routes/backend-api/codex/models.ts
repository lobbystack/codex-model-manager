import { createFileRoute } from "@tanstack/react-router"

import { getCodexModels, optionsResponse } from "@/proxy/handlers"

export const Route = createFileRoute("/backend-api/codex/models")({
  server: {
    handlers: {
      GET: () => getCodexModels(),
      OPTIONS: () => optionsResponse(),
    },
  },
})
