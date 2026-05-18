import { createFileRoute } from "@tanstack/react-router"

import { apiJson, apiOptions, readJson } from "@/server/api/json"
import { completeOAuth } from "@/server/oauth/service"

export const Route = createFileRoute("/api/oauth/complete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readJson(request)
        return apiJson(
          completeOAuth({
            deviceAuthId:
              typeof body.deviceAuthId === "string" ? body.deviceAuthId : undefined,
            userCode: typeof body.userCode === "string" ? body.userCode : undefined,
          })
        )
      },
      OPTIONS: () => apiOptions(),
    },
  },
})
