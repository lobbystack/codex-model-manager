import { createFileRoute } from "@tanstack/react-router"

import { apiJson, apiOptions } from "@/server/api/json"
import { checkForUpdate } from "@/server/system/updater"

export const Route = createFileRoute("/api/system/update/check")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return apiJson(await checkForUpdate())
        } catch (error) {
          return apiJson(
            {
              ok: false,
              updateAvailable: false,
              error: {
                message:
                  error instanceof Error
                    ? error.message
                    : "Unable to check for updates.",
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
