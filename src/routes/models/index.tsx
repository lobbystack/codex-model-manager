import { createFileRoute } from "@tanstack/react-router"
import { Activity, Search, Triangle, Zap } from "lucide-react"
import { useEffect, useState } from "react"
import type { ElementType } from "react"

import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/models/")({
  component: ModelsPage,
})

type ProviderTab = "chatgpt" | "openrouter" | "opencode-zen" | "ollama-cloud"

type ModelRow = {
  id: string
  displayName: string
  provider: ProviderTab
  providerName: string
  upstreamModel: string
  enabled: boolean
  supportsReasoning: boolean
  supportedParameters: Array<string>
  contextWindow: number
  outputLimit: number
  inputModalities: Array<string>
  icon: ElementType
}

type ProviderModelsResponse = {
  models?: Array<{
    id: string
    displayName: string
    providerName: string
    upstreamModel: string
    enabled: boolean
    supportsReasoning: boolean
    supportedParameters: Array<string>
    contextWindow: number
    outputLimit: number
    inputModalities?: Array<string>
  }>
  error?: {
    message?: string
  }
}

const providerIcons: Record<string, ElementType | undefined> = {
  anthropic: Activity,
  chatgpt: Triangle,
  google: Zap,
  moonshot: Activity,
  openai: Triangle,
  ollama: Triangle,
  opencode: Triangle,
  qwen: Activity,
}

const modelAesthetics: Record<
  string,
  { icon: ElementType; providerName: string } | undefined
> = {
  "openrouter/anthropic/claude-sonnet-4.5": {
    icon: Activity,
    providerName: "Anthropic",
  },
  "openrouter/google/gemini-2.5-pro": { icon: Zap, providerName: "Google" },
  "openrouter/qwen/qwen3-coder": { icon: Activity, providerName: "Qwen" },
}

const providerModelCache: Partial<Record<ProviderTab, Array<ModelRow>>> = {}

function iconForModel(id: string) {
  if (
    !id.startsWith("openrouter/") &&
    !id.startsWith("opencode/") &&
    !id.startsWith("ollama/")
  ) {
    return Triangle
  }

  if (id.startsWith("ollama/")) {
    return Triangle
  }

  if (id.startsWith("opencode/")) {
    const model = id.replace(/^opencode\//, "")

    if (model.startsWith("claude-")) {
      return Activity
    }

    if (model.startsWith("gemini-")) {
      return Zap
    }

    return Triangle
  }

  const providerSlug = id.replace(/^openrouter\//, "").split("/")[0]
  return modelAesthetics[id]?.icon || providerIcons[providerSlug] || Activity
}

function toModelRows(
  models: NonNullable<ProviderModelsResponse["models"]>,
  provider: ProviderTab
) {
  return models.map((model) => ({
    id: model.id,
    displayName: model.displayName,
    provider,
    providerName: modelAesthetics[model.id]?.providerName || model.providerName,
    upstreamModel: model.upstreamModel,
    enabled: model.enabled,
    supportsReasoning: model.supportsReasoning,
    supportedParameters: model.supportedParameters,
    contextWindow: model.contextWindow,
    outputLimit: model.outputLimit,
    inputModalities: model.inputModalities || ["text"],
    icon: iconForModel(model.id),
  }))
}

function ModelsPage() {
  const [activeTab, setActiveTab] = useState<ProviderTab>("chatgpt")
  const [searchQuery, setSearchQuery] = useState("")
  const [models, setModels] = useState<Array<ModelRow>>([])
  const [enabledStates, setEnabledStates] = useState<
    Record<string, boolean | undefined>
  >({})
  const [savingStates, setSavingStates] = useState<
    Record<string, boolean | undefined>
  >({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const tabs = [
    { id: "chatgpt", label: "ChatGPT" },
    { id: "openrouter", label: "OpenRouter" },
    { id: "opencode-zen", label: "OpenCode Zen" },
    { id: "ollama-cloud", label: "Ollama Cloud" },
  ] as const
  const activeTabLabel =
    tabs.find((tab) => tab.id === activeTab)?.label || "provider"

  const isEnabled = (id: string, defaultState: boolean) => {
    return enabledStates[id] !== undefined ? enabledStates[id] : defaultState
  }

  const filteredModels = models
    .filter(
      (model) =>
        model.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        model.providerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        model.id.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      return (
        Number(isEnabled(b.id, b.enabled)) - Number(isEnabled(a.id, a.enabled))
      )
    })

  useEffect(() => {
    async function loadProviderModels() {
      const cachedModels = providerModelCache[activeTab]

      if (cachedModels) {
        setModels(cachedModels)
        setIsLoading(false)
        setError(null)
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/providers/${activeTab}`)
        const data = (await response.json()) as ProviderModelsResponse

        if (!response.ok) {
          throw new Error(
            data.error?.message || `Unable to load ${activeTabLabel} models.`
          )
        }

        const nextModels = toModelRows(data.models || [], activeTab)

        providerModelCache[activeTab] = nextModels
        setModels(nextModels)
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : `Unable to load ${activeTabLabel} models.`
        )
      } finally {
        setIsLoading(false)
      }
    }

    setEnabledStates({})
    setSavingStates({})
    void loadProviderModels()
  }, [activeTab, activeTabLabel])

  const toggleModel = async (model: ModelRow, enabled: boolean) => {
    setEnabledStates((prev) => ({
      ...prev,
      [model.id]: enabled,
    }))
    setSavingStates((prev) => ({ ...prev, [model.id]: true }))
    setError(null)

    try {
      const response = await fetch(`/api/providers/${model.provider}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: model.id,
          displayName: model.displayName,
          providerName: model.providerName,
          upstreamModel: model.upstreamModel,
          enabled,
          supportsReasoning: model.supportsReasoning,
          supportedParameters: model.supportedParameters,
          contextWindow: model.contextWindow,
          outputLimit: model.outputLimit,
          inputModalities: model.inputModalities,
        }),
      })
      const data = (await response.json()) as ProviderModelsResponse

      if (!response.ok) {
        throw new Error(data.error?.message || "Unable to update model.")
      }

      setModels((prev) =>
        prev.map((candidate) => {
          const nextCandidate =
            candidate.id === model.id ? { ...candidate, enabled } : candidate

          return nextCandidate
        })
      )
      providerModelCache[model.provider] = providerModelCache[
        model.provider
      ]?.map((candidate) =>
        candidate.id === model.id ? { ...candidate, enabled } : candidate
      )
    } catch (saveError) {
      setEnabledStates((prev) => ({ ...prev, [model.id]: model.enabled }))
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to update model."
      )
    } finally {
      setSavingStates((prev) => ({ ...prev, [model.id]: false }))
    }
  }

  return (
    <>
      <header className="flex h-14 items-center gap-4 border-b bg-background px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-6 lg:h-[60px]">
        <div>
          <h1 className="text-lg font-semibold md:text-2xl">Models</h1>
          <p className="text-sm text-muted-foreground">
            Manage which models appear in Codex
          </p>
        </div>
      </header>
      <main className="flex-1 p-4 sm:px-6 sm:py-0">
        <div className="flex h-full animate-in flex-col duration-500 fade-in md:flex-row">
          {/* Left Sub-Navigation */}
          <aside className="w-full shrink-0 border-r border-border/40 py-6 pr-6 md:w-56 lg:w-64">
            <nav className="flex flex-col gap-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-all ${
                    activeTab === tab.id
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                  {tab.label}
                  {activeTab === tab.id && (
                    <div className="h-4 w-1 rounded-full bg-foreground/20" />
                  )}
                </button>
              ))}
            </nav>
          </aside>

          {/* Main Content Area */}
          <div className="flex-1 overflow-auto py-6 md:px-10 lg:px-12">
            <section className="mx-auto max-w-5xl space-y-6">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold tracking-tight">Models</h2>
                <p className="text-sm text-muted-foreground">
                  Manage which models workspace members can access.{" "}
                  <a
                    href="#"
                    className="underline decoration-muted-foreground/50 underline-offset-4 transition-colors hover:text-foreground"
                  >
                    Learn more.
                  </a>
                </p>
              </div>

              {/* Search */}
              <div className="relative max-w-sm">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground/70" />
                <Input
                  placeholder="Search models..."
                  className="border-border/40 bg-transparent pl-9 focus-visible:ring-1 focus-visible:ring-foreground/20"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Table */}
              <div className="pt-2">
                <Table className="[&_tr]:border-border/20">
                  <TableHeader>
                    <TableRow className="border-border/40 hover:bg-transparent">
                      <TableHead className="h-9 px-0 text-xs font-medium tracking-widest text-muted-foreground/70 uppercase">
                        Model
                      </TableHead>
                      <TableHead className="h-9 text-xs font-medium tracking-widest text-muted-foreground/70 uppercase">
                        Provider
                      </TableHead>
                      <TableHead className="h-9 pr-2 text-right text-xs font-medium tracking-widest text-muted-foreground/70 uppercase">
                        Enabled
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredModels.map((model) => {
                      const Icon = model.icon
                      const currentlyEnabled = isEnabled(
                        model.id,
                        model.enabled
                      )

                      return (
                        <TableRow
                          key={model.id}
                          className="group border-border/20 transition-colors hover:bg-accent/10"
                        >
                          <TableCell className="px-0 py-5">
                            <div className="flex items-center gap-3">
                              <Icon className="size-4 text-muted-foreground/50 transition-colors group-hover:text-foreground/80" />
                              <span className="text-sm font-medium">
                                {model.displayName}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="py-5 text-sm text-muted-foreground">
                            {model.providerName}
                          </TableCell>
                          <TableCell className="py-5 pr-2 text-right">
                            <Switch
                              checked={currentlyEnabled}
                              disabled={savingStates[model.id] === true}
                              onCheckedChange={(checked) =>
                                void toggleModel(model, checked)
                              }
                              className="origin-right scale-90 data-[state=checked]:border-emerald-500 data-[state=checked]:!bg-emerald-500 dark:data-[state=checked]:!bg-emerald-500"
                            />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>

                {isLoading ? (
                  <div className="py-8 text-sm text-muted-foreground">
                    Loading {activeTabLabel} models...
                  </div>
                ) : null}

                {!isLoading && error ? (
                  <div className="py-8 text-sm text-destructive">{error}</div>
                ) : null}

                {!isLoading && !error && filteredModels.length === 0 ? (
                  <div className="py-8 text-sm text-muted-foreground">
                    No {activeTabLabel} models found.
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </main>
    </>
  )
}
