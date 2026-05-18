import { createFileRoute } from "@tanstack/react-router"

import { apiJson, apiOptions } from "@/server/api/json"
import { applyUpdate } from "@/server/system/updater"

export const Route = createFileRoute("/api/system/update/apply")({
  server: {
    handlers: {
      POST: async () => {
        try {
          return apiJson(await applyUpdate())
        } catch (error) {
          return apiJson(
            {
              ok: false,
              error: {
                message:
                  error instanceof Error
                    ? error.message
                    : "Unable to apply update.",
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
