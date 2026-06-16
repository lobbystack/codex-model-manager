import { Clock, Key, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"

interface Provider {
  id: string
  name: string
  email?: string
  plan?: string
  status: string
  type: string
}

interface ProviderDetailsProps {
  provider: Provider
  onRemoved?: () => void
}

type UsageLimitWindow = {
  remainingPercent: number | null
  resetAt: number | null
}

type UsageLimitResponse = {
  ok: boolean
  usage?: {
    primaryWindow: UsageLimitWindow | null
    secondaryWindow: UsageLimitWindow | null
    weeklyOnly?: boolean
    hasCredits?: boolean
    creditsBalance?: number | null
  }
}

function formatWholePercent(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "--"
  }

  return `${Math.round(value)}%`
}

function formatResetLabel(resetAt: number | null | undefined) {
  if (!resetAt) {
    return "Reset unavailable"
  }

  const diffMs = resetAt * 1000 - Date.now()

  if (diffMs <= 0) {
    return "Resetting..."
  }

  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000))
  const hours = Math.floor(diffMs / (60 * 60 * 1000))
  const minutes = Math.floor(diffMs / (60 * 1000))

  if (days > 0) {
    return `Resets in ${days} ${days === 1 ? "day" : "days"}`
  }

  if (hours > 0) {
    return `Resets in ${hours}h`
  }

  return `Resets in ${Math.max(1, minutes)}m`
}

function UsageLimitMeter({
  label,
  window,
}: {
  label: string
  window: UsageLimitWindow | null | undefined
}) {
  const remaining = window?.remainingPercent ?? null

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-4 text-base">
        <span className="font-medium">{label} remaining</span>
        <span className="font-mono text-emerald-500">
          {formatWholePercent(remaining)}
        </span>
      </div>
      {remaining === null ? (
        <div className="h-2 rounded-full bg-emerald-950/40" />
      ) : (
        <Progress
          value={remaining}
          className="[&_[data-slot=progress-indicator]]:bg-emerald-500 [&_[data-slot=progress-track]]:h-2 [&_[data-slot=progress-track]]:bg-emerald-950/40"
        />
      )}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Clock className="size-4" />
        <span>
          {formatResetLabel(window?.resetAt).replace(/^Resets/, "Reset")}
        </span>
      </div>
    </div>
  )
}

export function ChatGptUsageCard({ accountId }: { accountId: string }) {
  const [usageLimit, setUsageLimit] = useState<
    UsageLimitResponse["usage"] | null
  >(null)

  useEffect(() => {
    async function loadUsageLimit() {
      const response = await fetch(
        `/api/codex/usage-limit?accountId=${encodeURIComponent(accountId)}`
      )

      if (!response.ok) {
        return
      }

      const data = (await response.json()) as UsageLimitResponse
      setUsageLimit(data.usage || null)
    }

    void loadUsageLimit()
  }, [accountId])

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium tracking-wider text-muted-foreground uppercase">
          Usage
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        {!usageLimit?.weeklyOnly ? (
          <UsageLimitMeter label="5h" window={usageLimit?.primaryWindow} />
        ) : null}
        <UsageLimitMeter label="Weekly" window={usageLimit?.secondaryWindow} />
      </CardContent>
      {usageLimit?.hasCredits ? (
        <CardContent className="border-t pt-4 text-sm text-muted-foreground">
          {usageLimit.creditsBalance !== null &&
          usageLimit.creditsBalance !== undefined
            ? `Credits available: ${usageLimit.creditsBalance}`
            : "Additional credits available"}
        </CardContent>
      ) : null}
    </Card>
  )
}

export function ProviderDetails({
  provider,
  onRemoved,
}: ProviderDetailsProps) {
  const [isRemoving, setIsRemoving] = useState(false)
  const isChatGPT = provider.type === "ChatGPT"
  const isOpenCodeZen = provider.type === "OpenCode Zen"
  const isOpenCodeGo = provider.type === "OpenCode Go"
  const isOllamaCloud = provider.type === "Ollama Cloud"

  async function handleRemove() {
    if (!isChatGPT || isRemoving) {
      return
    }

    setIsRemoving(true)

    try {
      const response = await fetch(
        `/api/accounts/${encodeURIComponent(provider.id)}`,
        { method: "DELETE" }
      )

      if (response.ok) {
        onRemoved?.()
      }
    } finally {
      setIsRemoving(false)
    }
  }

  return (
    <div className="flex animate-in flex-col gap-6 duration-300 fade-in-50">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">
            {provider.email || provider.name}
          </h2>
          <p className="text-sm text-muted-foreground">{provider.name}</p>
        </div>
        {isChatGPT ? (
          <Button
            className="border-destructive/20 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={isRemoving}
            onClick={() => void handleRemove()}
            size="sm"
            variant="outline"
          >
            <Trash2 data-icon="inline-start" />
            {isRemoving ? "Removing..." : "Remove"}
          </Button>
        ) : null}
      </div>

      {isChatGPT ? (
        <>
          <ChatGptUsageCard accountId={provider.id} />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium tracking-wider text-muted-foreground uppercase">
                Token Status
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-0">
              <div className="flex items-center justify-between border-b py-3 last:border-0">
                <span className="text-sm font-medium text-muted-foreground">
                  Access
                </span>
                <span className="font-mono text-sm">Valid (in 7d)</span>
              </div>
              <div className="flex items-center justify-between border-b py-3 last:border-0">
                <span className="text-sm font-medium text-muted-foreground">
                  Refresh
                </span>
                <span className="font-mono text-sm">Stored</span>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium tracking-wider text-muted-foreground uppercase">
              API Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-0">
            <div className="flex items-center justify-between border-b py-3">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-muted-foreground">
                  API Key
                </span>
                <span className="text-xs text-muted-foreground">
                  Used to authenticate requests
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm">
                  {isOpenCodeZen || isOpenCodeGo
                    ? "zen-••••••••••••"
                    : isOllamaCloud
                      ? "ollama-••••••••••••"
                      : "sk-or-v1-••••••••••••"}
                </span>
                <Button
                  className="h-8 w-8 text-muted-foreground"
                  size="icon"
                  variant="ghost"
                >
                  <Key className="size-4" />
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between py-3">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-muted-foreground">
                  Base URL
                </span>
                <span className="text-xs text-muted-foreground">
                  Endpoint for API requests
                </span>
              </div>
              <span className="font-mono text-sm text-muted-foreground">
                {isOllamaCloud
                  ? "https://ollama.com/v1"
                  : isOpenCodeGo
                    ? "https://opencode.ai/zen/go/v1"
                    : isOpenCodeZen
                      ? "https://opencode.ai/zen/v1"
                      : "https://openrouter.ai/api/v1"}
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
