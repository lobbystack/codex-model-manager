import { createFileRoute } from "@tanstack/react-router"

import { getHealth, optionsResponse } from "@/proxy/handlers"

export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET: () => getHealth(),
      OPTIONS: () => optionsResponse(),
    },
  },
})
