# Codex Model Manager

A local browser app for managing Codex/OpenCode model providers and routing requests
through a localhost proxy.

## Development

```bash
bun install
bun run dev
```

The unified UI and proxy server runs on `http://localhost:1455`. Browser OAuth
uses `http://localhost:1455/auth/callback`, so keep this port for local use.

## Verification

```bash
bun run typecheck
bun run lint
bun run build
```

For proxy changes, start the production or dev server and smoke-test:

```bash
curl http://localhost:1455/health
curl http://localhost:1455/v1/models
```

## Local Distribution

Release builds are shipped as a local browser app. The installer places versioned
app files under the user's app data directory, starts a background launcher, and
opens `http://localhost:1455`.

macOS/Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/owner/repo/main/scripts/install.sh | CMM_GITHUB_REPO=owner/repo sh
```

Windows PowerShell:

```powershell
$env:CMM_GITHUB_REPO="owner/repo"; irm https://raw.githubusercontent.com/owner/repo/main/scripts/install.ps1 | iex
```

The app checks GitHub Releases for `codex-model-manager-manifest.json`. When a
newer version exists, the dashboard prompts before installing it.

## Release Packaging

```bash
bun run build
bun run package:release
```

The packaging script prepares `release/package`. The GitHub release workflow
archives that directory per platform, publishes checksums, and writes the update
manifest consumed by the local updater.
