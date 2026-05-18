import { createFileRoute } from "@tanstack/react-router"

import { apiJson, apiOptions } from "@/server/api/json"
import { listAccounts, listApiKeyProviders } from "@/server/accounts/store"

export const Route = createFileRoute("/api/accounts")({
  server: {
    handlers: {
      GET: async () =>
        apiJson({
          accounts: await listAccounts(),
          apiKeyProviders: await listApiKeyProviders(),
        }),
      OPTIONS: () => apiOptions(),
    },
  },
})
