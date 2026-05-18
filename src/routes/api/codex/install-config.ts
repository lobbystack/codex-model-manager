import { createFileRoute } from "@tanstack/react-router"

import { apiJson, apiOptions } from "@/server/api/json"
import { installCodexModelManagerConfig } from "@/server/codex/config-installer"

export const Route = createFileRoute("/api/codex/install-config")({
  server: {
    handlers: {
      POST: async () => {
        try {
          return apiJson({
            ok: true,
            ...(await installCodexModelManagerConfig()),
          })
        } catch (error) {
          return apiJson(
            {
              ok: false,
              error: {
                message:
                  error instanceof Error
                    ? error.message
                    : "Unable to install Codex config.",
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
