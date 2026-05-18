import { createFileRoute } from "@tanstack/react-router"
import { Search, Upload } from "lucide-react"
import { useEffect, useState } from "react"

import { AddProviderDialog } from "./-components/AddProviderDialog"
import { ProviderDetails } from "./-components/ProviderDetails"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export const Route = createFileRoute("/providers/")({
  component: ProvidersPage,
})

type ProviderStatus = "Active" | "Rate limited" | "Disconnected"
type ProviderType = "ChatGPT" | "OpenRouter" | "OpenCode Zen"

interface Provider {
  id: string
  name: string
  email?: string
  plan?: string
  status: ProviderStatus
  type: ProviderType
}

type AccountResponse = {
  accounts: Array<{
    id: string
    email: string
    planType: string
    status: "active" | "paused" | "deactivated"
  }>
  apiKeyProviders: Array<{
    id: string
    type: "openrouter" | "opencode-zen"
    name: string
    keyPrefix: string
    status: "active"
  }>
}

function accountStatus(status: AccountResponse["accounts"][number]["status"]): ProviderStatus {
  if (status === "active") {
    return "Active"
  }

  return "Disconnected"
}

function ProvidersPage() {
  const [providers, setProviders] = useState<Array<Provider>>([])
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const selectedProvider = providers.find(
    (provider) => provider.id === selectedProviderId
  )

  async function loadProviders() {
    setIsLoading(true)
    const response = await fetch("/api/accounts")
    const data = (await response.json()) as AccountResponse
    const chatGptProviders = data.accounts.map((account) => ({
      id: account.id,
      name: "ChatGPT",
      email: account.email,
      plan: account.planType,
      status: accountStatus(account.status),
      type: "ChatGPT" as const,
    }))
    const apiKeyProviders = data.apiKeyProviders.map((provider) => ({
      id: provider.id,
      name: provider.name,
      plan: provider.keyPrefix,
      status: "Active" as const,
      type: provider.type === "opencode-zen" ? "OpenCode Zen" as const : "OpenRouter" as const,
    }))
    const nextProviders = [...chatGptProviders, ...apiKeyProviders]

    setProviders(nextProviders)
    setSelectedProviderId((current) => current || nextProviders[0]?.id || null)
    setIsLoading(false)
  }

  useEffect(() => {
    void loadProviders()
  }, [])

  return (
    <>
      <header className="flex h-14 items-center gap-4 border-b bg-background px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-6 lg:h-[60px]">
        <h1 className="text-lg font-semibold md:text-2xl">Providers</h1>
      </header>
      <main className="flex-1 p-4 sm:px-6 sm:py-0">
        <p className="mb-6 text-sm text-muted-foreground">
          Manage imported accounts and API keys.
        </p>

        <div className="flex flex-col gap-6 md:flex-row">
          <div className="flex w-full shrink-0 flex-col gap-4 md:w-80">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
                <Input
                  className="bg-muted/50 pl-8"
                  placeholder="Search providers..."
                  type="search"
                />
              </div>
              <Select defaultValue="all">
                <SelectTrigger className="w-[130px] bg-muted/50">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="limited">Rate limited</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Button className="flex-1 bg-muted/50" variant="outline">
                <Upload data-icon="inline-start" />
                Import
              </Button>
              <AddProviderDialog onConnected={() => void loadProviders()} />
            </div>

            <div className="mt-2 flex flex-col gap-2">
              {isLoading ? (
                <div className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">
                  Loading providers...
                </div>
              ) : null}

              {!isLoading && providers.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  No providers connected. Add a provider to start routing Codex
                  requests.
                </div>
              ) : null}

              {providers.map((provider) => (
                <button
                  className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all hover:bg-accent ${
                    selectedProviderId === provider.id
                      ? "border-primary/50 bg-accent"
                      : "bg-card"
                  }`}
                  key={provider.id}
                  onClick={() => setSelectedProviderId(provider.id)}
                  type="button"
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="truncate pr-2 text-sm font-medium">
                      {provider.email || provider.name}
                    </span>
                    <Badge
                      className={`h-5 px-1.5 text-[10px] ${
                        provider.status === "Active"
                          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-500"
                          : "border-amber-500/20 bg-amber-500/10 text-amber-500"
                      }`}
                      variant="outline"
                    >
                      <span
                        className={`mr-1 size-1 rounded-full ${
                          provider.status === "Active"
                            ? "bg-emerald-500"
                            : "bg-amber-500"
                        }`}
                      />
                      {provider.status}
                    </Badge>
                  </div>
                  {provider.plan ? (
                    <span className="text-xs text-muted-foreground">
                      {provider.plan}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1">
            {selectedProvider ? (
              <ProviderDetails provider={selectedProvider} />
            ) : (
              <div className="flex h-full min-h-[400px] items-center justify-center rounded-lg border border-dashed">
                <p className="text-sm text-muted-foreground">
                  {providers.length === 0
                    ? "Connect a provider to view details"
                    : "Select a provider to view details"}
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  )
}
