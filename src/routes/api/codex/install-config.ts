import { createFileRoute } from "@tanstack/react-router"

import { apiJson, apiOptions } from "@/server/api/json"
import {
  getCodexModelManagerConfigStatus,
  installCodexModelManagerConfig,
  uninstallCodexModelManagerConfig,
} from "@/server/codex/config-installer"

export const Route = createFileRoute("/api/codex/install-config")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return apiJson({
            ok: true,
            ...(await getCodexModelManagerConfigStatus()),
          })
        } catch (error) {
          return apiJson(
            {
              ok: false,
              error: {
                message:
                  error instanceof Error
                    ? error.message
                    : "Unable to read Codex config.",
              },
            },
            500
          )
        }
      },
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
      DELETE: async () => {
        try {
          return apiJson({
            ok: true,
            ...(await uninstallCodexModelManagerConfig()),
          })
        } catch (error) {
          return apiJson(
            {
              ok: false,
              error: {
                message:
                  error instanceof Error
                    ? error.message
                    : "Unable to reset Codex config.",
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
