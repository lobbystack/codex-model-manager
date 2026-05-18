import { createFileRoute } from "@tanstack/react-router"

import { apiJson, apiOptions, readJson } from "@/server/api/json"
import { completeManualCallback } from "@/server/oauth/service"

export const Route = createFileRoute("/api/oauth/manual-callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readJson(request)

        if (typeof body.callbackUrl !== "string") {
          return apiJson(
            {
              status: "error",
              errorMessage: "callbackUrl is required.",
            },
            400
          )
        }

        try {
          return apiJson(await completeManualCallback(body.callbackUrl))
        } catch (error) {
          return apiJson(
            {
              status: "error",
              errorMessage:
                error instanceof Error ? error.message : "Manual callback failed.",
            },
            400
          )
        }
      },
      OPTIONS: () => apiOptions(),
    },
  },
})
