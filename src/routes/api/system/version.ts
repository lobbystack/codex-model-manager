import { createFileRoute } from "@tanstack/react-router"

import { apiJson, apiOptions } from "@/server/api/json"
import { getSystemVersion } from "@/server/system/updater"

export const Route = createFileRoute("/api/system/version")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return apiJson(await getSystemVersion())
        } catch (error) {
          return apiJson(
            {
              ok: false,
              error: {
                message:
                  error instanceof Error
                    ? error.message
                    : "Unable to read system version.",
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
