import { createFileRoute } from "@tanstack/react-router"

import { toCodexModelCatalog } from "@/proxy/codex-catalog"
import { getEnabledModels, optionsResponse, proxyJson } from "@/proxy/handlers"
import {
  codexModelCatalogPath,
  writeCodexModelCatalog,
} from "@/server/codex/catalog-file"

export const Route = createFileRoute("/api/codex/model-catalog")({
  server: {
    handlers: {
      GET: async () => {
        const models = await getEnabledModels()

        await writeCodexModelCatalog(models)

        return proxyJson({
          ...toCodexModelCatalog(models),
          catalog_path: codexModelCatalogPath(),
        })
      },
      OPTIONS: () => optionsResponse(),
    },
  },
})
