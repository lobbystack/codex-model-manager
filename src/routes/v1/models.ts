import { createFileRoute } from "@tanstack/react-router"

import { getOpenAIModels, optionsResponse } from "@/proxy/handlers"

export const Route = createFileRoute("/v1/models")({
  server: {
    handlers: {
      GET: () => getOpenAIModels(),
      OPTIONS: () => optionsResponse(),
    },
  },
})
