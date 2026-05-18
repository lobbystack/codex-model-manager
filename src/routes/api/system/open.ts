import { createFileRoute } from "@tanstack/react-router"

import { apiJson, apiOptions } from "@/server/api/json"
import { openLocalApp } from "@/server/system/open"

export const Route = createFileRoute("/api/system/open")({
  server: {
    handlers: {
      POST: async () => {
        try {
          return apiJson(await openLocalApp())
        } catch (error) {
          return apiJson(
            {
              ok: false,
              error: {
                message:
                  error instanceof Error
                    ? error.message
                    : "Unable to open browser.",
              },
            },
            500
          )
        }
      },
      OPTIONS: () => apiOptions(),
    },
  },
})
