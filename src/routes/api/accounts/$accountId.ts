import { createFileRoute } from "@tanstack/react-router"

import { apiJson, apiOptions, readJson } from "@/server/api/json"
import {
  deleteAccount,
  getAccountById,
  updateAccountStatus,
} from "@/server/accounts/store"
import { invalidateUsageCache } from "@/server/balancer/usage-cache"

export const Route = createFileRoute("/api/accounts/$accountId")({
  server: {
    handlers: {
      PATCH: async ({ params, request }) => {
        const account = await getAccountById(params.accountId)

        if (!account) {
          return apiJson({ error: { message: "Account not found." } }, 404)
        }

        const body = await readJson(request)
        const status = body.status

        if (status !== "active" && status !== "paused") {
          return apiJson(
            { error: { message: "Status must be active or paused." } },
            400
          )
        }

        const updated = await updateAccountStatus(params.accountId, status)
        invalidateUsageCache(params.accountId)

        return apiJson({ account: updated })
      },
      DELETE: async ({ params }) => {
        const account = await getAccountById(params.accountId)

        if (!account) {
          return apiJson({ error: { message: "Account not found." } }, 404)
        }

        await deleteAccount(params.accountId)
        invalidateUsageCache(params.accountId)

        return apiJson({ ok: true })
      },
      OPTIONS: () => apiOptions(),
    },
  },
})
