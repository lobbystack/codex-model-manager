import { createFileRoute } from "@tanstack/react-router"
import { Box, Network } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { managedModels } from "@/proxy/model-registry"

export const Route = createFileRoute("/")({ component: App })

function App() {
  const enabledModels = managedModels.filter((m) => m.enabled)

  return (
    <>
      <header className="flex h-14 items-center gap-4 border-b bg-background px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-6 lg:h-[60px]">
        <h1 className="text-lg font-semibold md:text-2xl">Overview</h1>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Proxy Online
          </Badge>
        </div>
      </header>
      <main className="grid flex-1 items-start gap-4 p-4 sm:px-6 sm:py-0 md:gap-8">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Active Models
              </CardTitle>
              <Box className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{enabledModels.length}</div>
              <p className="text-xs text-muted-foreground">
                Across all providers
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Upstreams</CardTitle>
              <Network className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">2</div>
              <p className="text-xs text-muted-foreground">
                OpenRouter, OpenAI Pool
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center">
            <div className="grid gap-2">
              <CardTitle>Managed Models</CardTitle>
              <CardDescription>
                Configure which models are exposed to the Codex CLI.
              </CardDescription>
            </div>
            <Button size="sm" className="ml-auto gap-1">
              Add Model
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead className="hidden md:table-cell">
                    Capabilities
                  </TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {managedModels.map((model) => (
                  <TableRow key={model.id}>
                    <TableCell>
                      <div className="font-medium">{model.displayName}</div>
                      <div className="hidden font-mono text-xs text-muted-foreground md:inline">
                        {model.id}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="font-mono text-[10px]"
                      >
                        {model.provider}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex gap-1">
                        {model.supportsResponses && (
                          <Badge variant="secondary" className="text-[10px]">
                            Responses
                          </Badge>
                        )}
                        {model.supportsChatCompletions && (
                          <Badge variant="secondary" className="text-[10px]">
                            Chat
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Switch
                        checked={model.enabled}
                        aria-label="Toggle model status"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </>
  )
}
