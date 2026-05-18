import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import type { ManagedModel } from "@/proxy/model-registry"
import { toCodexModelCatalog } from "@/proxy/codex-catalog"

export function codexModelCatalogPath() {
  return (
    process.env.CMM_CODEX_MODEL_CATALOG_PATH ||
    join(homedir(), ".codex", "codex-model-manager-catalog.json")
  )
}

function codexModelsCachePath() {
  return process.env.CMM_CODEX_MODELS_CACHE_PATH || join(homedir(), ".codex", "models_cache.json")
}

async function readExistingCacheMetadata(path: string) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      client_version?: unknown
      etag?: unknown
    }

    return {
      client_version:
        typeof parsed.client_version === "string" ? parsed.client_version : undefined,
      etag: typeof parsed.etag === "string" ? parsed.etag : undefined,
    }
  } catch {
    return {}
  }
}

async function writeCodexModelsCache(models: Array<ManagedModel>) {
  const path = codexModelsCachePath()
  const catalog = toCodexModelCatalog(models)
  const metadata = await readExistingCacheMetadata(path)
  const cache = {
    fetched_at: new Date().toISOString(),
    ...metadata,
    models: catalog.models,
  }

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(cache, null, 2)}\n`, "utf8")
}

export async function writeCodexModelCatalog(models: Array<ManagedModel>) {
  const path = codexModelCatalogPath()
  const catalog = toCodexModelCatalog(models)

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(catalog, null, 2)}\n`, "utf8")
  await writeCodexModelsCache(models)

  return path
}
