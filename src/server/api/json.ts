export function apiJson(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    },
  })
}

export function apiOptions() {
  return apiJson({ ok: true })
}

export async function readJson(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}
