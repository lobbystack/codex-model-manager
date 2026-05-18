import { createFileRoute } from "@tanstack/react-router"

import { completeBrowserCallback } from "@/server/oauth/service"

function htmlResponse(title: string, message: string, ok: boolean) {
  const color = ok ? "#047857" : "#b91c1c"

  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:system-ui,sans-serif;margin:0;display:grid;min-height:100vh;place-items:center;background:#fafafa;color:#111827}.card{max-width:420px;border:1px solid #e5e7eb;border-radius:14px;background:white;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,.06)}h1{margin:0 0 8px;color:${color};font-size:20px}p{margin:0;color:#4b5563;line-height:1.5}</style></head><body><main class="card"><h1>${title}</h1><p>${message}</p></main></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  )
}

export const Route = createFileRoute("/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const result = await completeBrowserCallback(new URL(request.url))

        if (result.status === "success") {
          return htmlResponse(
            "Login complete",
            "Your ChatGPT account was connected. You can return to Codex Model Manager.",
            true
          )
        }

        return htmlResponse(
          "Login failed",
          result.errorMessage || "Authorization failed.",
          false
        )
      },
    },
  },
})
