import { Key, Trash2 } from "lucide-react"

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
}

export function ProviderDetails({ provider }: ProviderDetailsProps) {
  const isChatGPT = provider.type === "ChatGPT"

  return (
    <div className="flex animate-in flex-col gap-6 duration-300 fade-in-50">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">
            {provider.email || provider.name}
          </h2>
          <p className="text-sm text-muted-foreground">{provider.name}</p>
        </div>
        <Button
          className="border-destructive/20 text-destructive hover:bg-destructive/10 hover:text-destructive"
          size="sm"
          variant="outline"
        >
          <Trash2 data-icon="inline-start" />
          Remove
        </Button>
      </div>

      {isChatGPT ? (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium tracking-wider text-muted-foreground uppercase">
                Usage
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Weekly Rate Limit</span>
                  <span className="font-mono text-emerald-500">97%</span>
                </div>
                <Progress value={97} />
                <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
                  <span>Resets in 5 days</span>
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-primary" /> 5h
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-emerald-500" />
                      Weekly
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

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
                  sk-or-v1-••••••••••••
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
                https://openrouter.ai/api/v1
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
