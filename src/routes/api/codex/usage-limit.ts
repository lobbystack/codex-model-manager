import { createFileRoute } from "@tanstack/react-router"

import { apiJson, apiOptions } from "@/server/api/json"
import { getChatGptUsageLimit } from "@/server/codex/usage-limit"

export const Route = createFileRoute("/api/codex/usage-limit")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return apiJson({
            ok: true,
            usage: await getChatGptUsageLimit(),
          })
        } catch (error) {
          return apiJson(
            {
              ok: false,
              error: {
                message:
                  error instanceof Error
                    ? error.message
                    : "Unable to load usage limit.",
              },
            },
            502
          )
        }
      },
      OPTIONS: () => apiOptions(),
    },
  },
})
