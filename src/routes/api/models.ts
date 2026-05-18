import { createFileRoute } from "@tanstack/react-router"

import { getManagedModels, optionsResponse } from "@/proxy/handlers"

export const Route = createFileRoute("/api/models")({
  server: {
    handlers: {
      GET: () => getManagedModels(),
      OPTIONS: () => optionsResponse(),
    },
  },
})
