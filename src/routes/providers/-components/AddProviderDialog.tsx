import { Box, Check, CircleAlert, Copy, ExternalLink, Key, Loader2, Plus } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Step = "choose" | "chatgpt" | "openrouter" | "opencode-zen"
type OAuthStage = "intro" | "browser" | "device" | "success" | "error"

type OAuthState = {
  stage: OAuthStage
  authorizationUrl: string | null
  callbackUrl: string | null
  verificationUrl: string | null
  userCode: string | null
  deviceAuthId: string | null
  intervalSeconds: number | null
  expiresInSeconds: number | null
  errorMessage: string | null
}

type AddProviderDialogProps = {
  onConnected: () => void
}

const initialOAuthState: OAuthState = {
  stage: "intro",
  authorizationUrl: null,
  callbackUrl: null,
  verificationUrl: null,
  userCode: null,
  deviceAuthId: null,
  intervalSeconds: null,
  expiresInSeconds: null,
  errorMessage: null,
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = (await response.json()) as T & {
    error?: { message?: string }
    errorMessage?: string
  }

  if (!response.ok) {
    throw new Error(data.error?.message || data.errorMessage || "Request failed")
  }

  return data
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Button onClick={copy} size="sm" variant="ghost">
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  )
}

export function AddProviderDialog({ onConnected }: AddProviderDialogProps) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>("choose")
  const [method, setMethod] = useState<"browser" | "device">("browser")
  const [currentPort, setCurrentPort] = useState("")
  const [openRouterKey, setOpenRouterKey] = useState("")
  const [openRouterError, setOpenRouterError] = useState<string | null>(null)
  const [openCodeZenKey, setOpenCodeZenKey] = useState("")
  const [openCodeZenError, setOpenCodeZenError] = useState<string | null>(null)
  const [isSavingOpenRouter, setIsSavingOpenRouter] = useState(false)
  const [isSavingOpenCodeZen, setIsSavingOpenCodeZen] = useState(false)
  const [manualCallbackUrl, setManualCallbackUrl] = useState("")
  const [oauthState, setOAuthState] = useState<OAuthState>(initialOAuthState)
  const isRegisteredOAuthPort = currentPort === "1455"

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen)
    if (!isOpen) {
      setTimeout(() => {
        setStep("choose")
        setMethod("browser")
        setOpenRouterKey("")
        setOpenRouterError(null)
        setOpenCodeZenKey("")
        setOpenCodeZenError(null)
        setIsSavingOpenRouter(false)
        setIsSavingOpenCodeZen(false)
        setManualCallbackUrl("")
        setOAuthState(initialOAuthState)
      }, 300)
    }
  }

  async function pollStatus() {
    const response = await fetch("/api/oauth/status")
    const status = (await response.json()) as {
      status: "pending" | "success" | "error"
      errorMessage: string | null
    }

    if (status.status === "success") {
      setOAuthState((current) => ({ ...current, stage: "success" }))
      onConnected()
    } else if (status.status === "error") {
      setOAuthState((current) => ({
        ...current,
        stage: "error",
        errorMessage: status.errorMessage || "Authorization failed.",
      }))
    }
  }

  async function startOAuth(forceMethod = method) {
    if (forceMethod === "browser" && !isRegisteredOAuthPort) {
      setOAuthState((current) => ({
        ...current,
        stage: "error",
        errorMessage:
          "Browser sign-in must run from http://localhost:1455 because OpenAI's Codex OAuth client redirects there. Stop the current dev server, run `bun run dev`, then open http://localhost:1455/providers. Device code sign-in also works from this page.",
      }))
      return
    }

    setOAuthState((current) => ({ ...current, stage: "intro", errorMessage: null }))

    try {
      const response = await postJson<{
        method: "browser" | "device"
        authorizationUrl?: string
        callbackUrl?: string
        verificationUrl?: string
        userCode?: string
        deviceAuthId?: string
        intervalSeconds?: number
        expiresInSeconds?: number
      }>("/api/oauth/start", { forceMethod })

      const nextState: OAuthState = {
        stage: response.method,
        authorizationUrl: response.authorizationUrl || null,
        callbackUrl: response.callbackUrl || null,
        verificationUrl: response.verificationUrl || null,
        userCode: response.userCode || null,
        deviceAuthId: response.deviceAuthId || null,
        intervalSeconds: response.intervalSeconds || null,
        expiresInSeconds: response.expiresInSeconds || null,
        errorMessage: null,
      }

      setOAuthState(nextState)

      if (response.method === "browser" && response.authorizationUrl) {
        window.open(response.authorizationUrl, "_blank", "noopener,noreferrer")
      }

      if (response.method === "device") {
        await postJson("/api/oauth/complete", {
          deviceAuthId: response.deviceAuthId,
          userCode: response.userCode,
        })
      }
    } catch (error) {
      setOAuthState((current) => ({
        ...current,
        stage: "error",
        errorMessage: error instanceof Error ? error.message : "OAuth failed.",
      }))
    }
  }

  async function submitManualCallback() {
    try {
      const response = await postJson<{
        status: "success" | "error"
        errorMessage?: string | null
      }>("/api/oauth/manual-callback", { callbackUrl: manualCallbackUrl })

      if (response.status === "success") {
        setOAuthState((current) => ({ ...current, stage: "success" }))
        onConnected()
      } else {
        setOAuthState((current) => ({
          ...current,
          stage: "error",
          errorMessage: response.errorMessage || "Manual callback failed.",
        }))
      }
    } catch (error) {
      setOAuthState((current) => ({
        ...current,
        stage: "error",
        errorMessage:
          error instanceof Error ? error.message : "Manual callback failed.",
      }))
    }
  }

  async function saveOpenRouterKey() {
    setOpenRouterError(null)
    setIsSavingOpenRouter(true)

    try {
      await postJson("/api/providers/openrouter", { apiKey: openRouterKey })
      onConnected()
      handleOpenChange(false)
    } catch (error) {
      setOpenRouterError(
        error instanceof Error ? error.message : "Failed to save OpenRouter key."
      )
    } finally {
      setIsSavingOpenRouter(false)
    }
  }

  async function saveOpenCodeZenKey() {
    setOpenCodeZenError(null)
    setIsSavingOpenCodeZen(true)

    try {
      await postJson("/api/providers/opencode-zen", { apiKey: openCodeZenKey })
      onConnected()
      handleOpenChange(false)
    } catch (error) {
      setOpenCodeZenError(
        error instanceof Error
          ? error.message
          : "Failed to save OpenCode Zen key."
      )
    } finally {
      setIsSavingOpenCodeZen(false)
    }
  }

  useEffect(() => {
    setCurrentPort(window.location.port)
  }, [])

  useEffect(() => {
    if (step === "chatgpt" && currentPort && !isRegisteredOAuthPort) {
      setMethod("device")
    }
  }, [currentPort, isRegisteredOAuthPort, step])

  useEffect(() => {
    if (!open || step !== "chatgpt") {
      return
    }

    if (oauthState.stage !== "browser" && oauthState.stage !== "device") {
      return
    }

    const interval = window.setInterval(
      () => void pollStatus(),
      Math.max(oauthState.intervalSeconds || 2, 2) * 1000
    )

    return () => window.clearInterval(interval)
  }, [oauthState.intervalSeconds, oauthState.stage, open, step])

  useEffect(() => {
    if (oauthState.stage !== "device" || !oauthState.expiresInSeconds) {
      return
    }

    const interval = window.setInterval(() => {
      setOAuthState((current) => ({
        ...current,
        expiresInSeconds: Math.max((current.expiresInSeconds || 0) - 1, 0),
      }))
    }, 1000)

    return () => window.clearInterval(interval)
  }, [oauthState.expiresInSeconds, oauthState.stage])

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger render={<Button className="flex-1" />}>
        <Plus data-icon="inline-start" />
        Add Provider
      </DialogTrigger>
      <DialogContent className="max-w-[min(92vw,560px)] overflow-hidden sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {step === "choose" ? "Add Provider" : null}
            {step === "chatgpt" ? "Sign in with ChatGPT" : null}
            {step === "openrouter" ? "Add OpenRouter API Key" : null}
            {step === "opencode-zen" ? "Add OpenCode Zen API Key" : null}
          </DialogTitle>
          <DialogDescription>
            {step === "choose" ? "Choose a provider type to connect." : null}
            {step === "chatgpt"
              ? "Sign in securely via your browser to authorize access."
              : null}
            {step === "openrouter"
              ? "Enter your OpenRouter API key to connect the provider."
              : null}
            {step === "opencode-zen"
              ? "Enter your OpenCode Zen API key to connect the provider."
              : null}
          </DialogDescription>
        </DialogHeader>

        {step === "choose" ? (
          <div className="grid gap-3 py-4">
            <button
              className="flex items-start gap-4 rounded-lg border p-4 text-left transition-colors hover:bg-accent focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-none"
              onClick={() => setStep("chatgpt")}
              type="button"
            >
              <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                <Box className="size-5 text-foreground" />
              </div>
              <div className="grid gap-1">
                <span className="text-sm font-semibold">ChatGPT Account</span>
                <span className="text-xs text-muted-foreground">
                  Connect via browser OAuth (PKCE).
                </span>
              </div>
            </button>

            <button
              className="flex items-start gap-4 rounded-lg border p-4 text-left transition-colors hover:bg-accent focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-none"
              onClick={() => setStep("openrouter")}
              type="button"
            >
              <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                <Key className="size-5 text-foreground" />
              </div>
              <div className="grid gap-1">
                <span className="text-sm font-semibold">
                  OpenRouter API Key
                </span>
                <span className="text-xs text-muted-foreground">
                  Connect using a standard API key.
                </span>
              </div>
            </button>

            <button
              className="flex items-start gap-4 rounded-lg border p-4 text-left transition-colors hover:bg-accent focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-none"
              onClick={() => setStep("opencode-zen")}
              type="button"
            >
              <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                <Key className="size-5 text-foreground" />
              </div>
              <div className="grid gap-1">
                <span className="text-sm font-semibold">
                  OpenCode Zen API Key
                </span>
                <span className="text-xs text-muted-foreground">
                  Connect using your Zen pay-as-you-go API key.
                </span>
              </div>
            </button>
          </div>
        ) : null}

        {step === "chatgpt" ? (
          <div className="grid min-w-0 gap-4 py-4">
            {oauthState.stage === "intro" ? (
              <div className="grid gap-2">
                {!isRegisteredOAuthPort && currentPort ? (
                  <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                    Browser OAuth redirects to localhost:1455. Restart with
                    <code className="mx-1 rounded bg-background/60 px-1">
                      bun run dev
                    </code>
                    and open localhost:1455, or use device code below.
                  </div>
                ) : null}
                <button
                  className={`rounded-lg border p-3 text-left transition-colors hover:bg-accent ${
                    method === "browser" ? "border-primary bg-accent" : ""
                  }`}
                  onClick={() => setMethod("browser")}
                  disabled={!isRegisteredOAuthPort && Boolean(currentPort)}
                  type="button"
                >
                  <span className="text-sm font-medium">Browser PKCE</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Opens OpenAI sign-in and returns to localhost:1455.
                  </span>
                </button>
                <button
                  className={`rounded-lg border p-3 text-left transition-colors hover:bg-accent ${
                    method === "device" ? "border-primary bg-accent" : ""
                  }`}
                  onClick={() => setMethod("device")}
                  type="button"
                >
                  <span className="text-sm font-medium">Device code</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Enter a short code on OpenAI's verification page.
                  </span>
                </button>
              </div>
            ) : null}

            {oauthState.stage === "browser" ? (
              <div className="grid min-w-0 gap-3 text-sm">
                <div className="min-w-0 overflow-hidden rounded-lg border bg-muted/30 p-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    Authorization URL
                  </p>
                  <p className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs">
                    {oauthState.authorizationUrl}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {oauthState.authorizationUrl ? (
                      <>
                        <CopyButton text={oauthState.authorizationUrl} />
                        <Button render={<a href={oauthState.authorizationUrl} target="_blank" rel="noreferrer" />} size="sm">
                          <ExternalLink className="size-3" />
                          Open
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="manualCallback">Manual callback URL</Label>
                  <div className="flex min-w-0 gap-2">
                    <Input
                      className="min-w-0"
                      id="manualCallback"
                      onChange={(event) => setManualCallbackUrl(event.target.value)}
                      placeholder="http://localhost:1455/auth/callback?code=..."
                      value={manualCallbackUrl}
                    />
                    <Button
                      disabled={!manualCallbackUrl.trim()}
                      onClick={submitManualCallback}
                      variant="outline"
                    >
                      Submit
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  Waiting for browser authorization...
                </div>
              </div>
            ) : null}

            {oauthState.stage === "device" ? (
              <div className="grid gap-3 text-sm">
                {oauthState.userCode ? (
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      User code
                    </p>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono text-lg font-semibold tracking-widest">
                        {oauthState.userCode}
                      </p>
                      <CopyButton text={oauthState.userCode} />
                    </div>
                  </div>
                ) : null}
                {oauthState.verificationUrl ? (
                  <Button render={<a href={oauthState.verificationUrl} target="_blank" rel="noreferrer" />}>
                    <ExternalLink className="size-4" />
                    Open verification page
                  </Button>
                ) : null}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  Waiting for authorization
                  {oauthState.expiresInSeconds
                    ? `, expires in ${Math.floor(oauthState.expiresInSeconds / 60)}m ${oauthState.expiresInSeconds % 60}s`
                    : "..."}
                </div>
              </div>
            ) : null}

            {oauthState.stage === "success" ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
                <Check className="size-4" />
                ChatGPT account connected.
              </div>
            ) : null}

            {oauthState.stage === "error" ? (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <CircleAlert className="mt-0.5 size-4" />
                <span>{oauthState.errorMessage || "Authorization failed."}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === "openrouter" ? (
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                autoComplete="off"
                id="apiKey"
                onChange={(event) => setOpenRouterKey(event.target.value)}
                placeholder="sk-or-v1-..."
                type="password"
                value={openRouterKey}
              />
            </div>
            {openRouterError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {openRouterError}
              </div>
            ) : null}
          </div>
        ) : null}

        {step === "opencode-zen" ? (
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="openCodeZenApiKey">API Key</Label>
              <Input
                autoComplete="off"
                id="openCodeZenApiKey"
                onChange={(event) => setOpenCodeZenKey(event.target.value)}
                placeholder="opencode_..."
                type="password"
                value={openCodeZenKey}
              />
            </div>
            {openCodeZenError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {openCodeZenError}
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:justify-end sm:gap-0">
          {step !== "choose" ? (
            <Button
              className="sm:mr-auto"
              onClick={() => setStep("choose")}
              variant="outline"
            >
              Back
            </Button>
          ) : null}
          <Button onClick={() => handleOpenChange(false)} variant="ghost">
            Cancel
          </Button>
          {step === "chatgpt" && oauthState.stage === "intro" ? (
            <Button onClick={() => void startOAuth()}>Start sign-in</Button>
          ) : null}
          {step === "chatgpt" && oauthState.stage === "success" ? (
            <Button onClick={() => handleOpenChange(false)}>Done</Button>
          ) : null}
          {step === "chatgpt" && oauthState.stage === "error" ? (
            <Button onClick={() => setOAuthState(initialOAuthState)}>
              Try again
            </Button>
          ) : null}
          {step === "openrouter" ? (
            <Button
              disabled={!openRouterKey.trim() || isSavingOpenRouter}
              onClick={() => void saveOpenRouterKey()}
            >
              {isSavingOpenRouter ? "Saving..." : "Save API Key"}
            </Button>
          ) : null}
          {step === "opencode-zen" ? (
            <Button
              disabled={!openCodeZenKey.trim() || isSavingOpenCodeZen}
              onClick={() => void saveOpenCodeZenKey()}
            >
              {isSavingOpenCodeZen ? "Saving..." : "Save API Key"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
