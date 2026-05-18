import { createFileRoute } from "@tanstack/react-router"

import { apiJson, apiOptions, readJson } from "@/server/api/json"
import { OAuthError } from "@/server/oauth/client"
import { startOAuth } from "@/server/oauth/service"

export const Route = createFileRoute("/api/oauth/start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readJson(request)
        const forceMethod =
          body.forceMethod === "device" || body.forceMethod === "browser"
            ? body.forceMethod
            : undefined

        try {
          return apiJson(await startOAuth({ forceMethod }))
        } catch (error) {
          if (error instanceof OAuthError) {
            return apiJson(
              { error: { code: error.code, message: error.message } },
              error.statusCode || 502
            )
          }

          return apiJson(
            {
              error: {
                code: "oauth_start_failed",
                message:
                  error instanceof Error ? error.message : "OAuth start failed",
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
