import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { arch, homedir, platform, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const APP_NAME = "codex-model-manager"
const MANIFEST_ASSET = "codex-model-manager-manifest.json"

type ReleaseAsset = {
  platform: string
  arch: string
  format?: "tar.gz" | "zip"
  url: string
  sha256?: string
}

type ReleaseManifest = {
  version: string
  notes?: string
  publishedAt?: string
  assets: Array<ReleaseAsset>
}

type PackageInfo = {
  version?: string
}

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readPackageInfo(): Promise<PackageInfo> {
  try {
    return JSON.parse(await readFile(resolve("package.json"), "utf8")) as PackageInfo
  } catch {
    return {}
  }
}

function installRoot() {
  if (process.env.CMM_INSTALL_ROOT) {
    return process.env.CMM_INSTALL_ROOT
  }

  if (platform() === "win32") {
    return join(process.env.LOCALAPPDATA || homedir(), "CodexModelManager")
  }

  return join(homedir(), ".codex-model-manager")
}

function versionsDir() {
  return join(installRoot(), "app", "versions")
}

function activePath() {
  return join(installRoot(), "app", "active")
}

function normalizeVersion(version: string) {
  return version.replace(/^v/i, "").split(/[+-]/)[0]
}

function compareVersions(left: string, right: string) {
  const leftParts = normalizeVersion(left).split(".").map(Number)
  const rightParts = normalizeVersion(right).split(".").map(Number)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] || 0) - (rightParts[index] || 0)

    if (diff !== 0) {
      return diff
    }
  }

  return 0
}

async function isDevCheckout() {
  return (await exists(resolve(".git"))) || (await exists(resolve("src")))
}

export async function getSystemVersion() {
  const packageInfo = await readPackageInfo()
  const devCheckout = await isDevCheckout()

  return {
    ok: true,
    name: APP_NAME,
    version: process.env.CMM_VERSION || packageInfo.version || "0.0.0-dev",
    platform: platform(),
    arch: arch(),
    port: Number(process.env.NITRO_PORT || process.env.PORT || 1455),
    host: process.env.NITRO_HOST || process.env.HOST || "127.0.0.1",
    installRoot: installRoot(),
    currentPath: resolve("."),
    releaseMode: process.env.CMM_RELEASE === "1" || !devCheckout,
    updateConfigured: Boolean(
      process.env.CMM_UPDATE_MANIFEST_URL || process.env.CMM_GITHUB_REPO
    ),
  }
}

async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      "user-agent": `${APP_NAME}-updater`,
      ...init.headers,
    },
  })

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`)
  }

  return (await response.json()) as T
}

async function fetchLatestManifest() {
  if (process.env.CMM_UPDATE_MANIFEST_URL) {
    return fetchJson<ReleaseManifest>(process.env.CMM_UPDATE_MANIFEST_URL)
  }

  const repo = process.env.CMM_GITHUB_REPO

  if (!repo) {
    throw new Error("Set CMM_GITHUB_REPO or CMM_UPDATE_MANIFEST_URL to enable updates.")
  }

  const release = await fetchJson<{
    assets?: Array<{ name?: string; browser_download_url?: string }>
  }>(`https://api.github.com/repos/${repo}/releases/latest`)
  const manifestAsset = release.assets?.find((asset) => asset.name === MANIFEST_ASSET)

  if (!manifestAsset?.browser_download_url) {
    throw new Error(`Latest GitHub release is missing ${MANIFEST_ASSET}.`)
  }

  return fetchJson<ReleaseManifest>(manifestAsset.browser_download_url)
}

function matchingAsset(manifest: ReleaseManifest) {
  return manifest.assets.find(
    (asset) => asset.platform === platform() && asset.arch === arch()
  )
}

export async function checkForUpdate() {
  const current = await getSystemVersion()
  const manifest = await fetchLatestManifest()
  const asset = matchingAsset(manifest)
  const updateAvailable = compareVersions(manifest.version, current.version) > 0

  return {
    ok: true,
    currentVersion: current.version,
    latestVersion: manifest.version,
    updateAvailable,
    notes: manifest.notes || null,
    publishedAt: manifest.publishedAt || null,
    supported: Boolean(asset),
    asset: asset
      ? {
          platform: asset.platform,
          arch: asset.arch,
          format: asset.format || (platform() === "win32" ? "zip" : "tar.gz"),
        }
      : null,
  }
}

async function downloadAsset(asset: ReleaseAsset, destination: string) {
  const response = await fetch(asset.url, {
    headers: { "user-agent": `${APP_NAME}-updater` },
  })

  if (!response.ok) {
    throw new Error(`Download failed with ${response.status}`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())

  if (asset.sha256) {
    const digest = createHash("sha256").update(bytes).digest("hex")

    if (digest.toLowerCase() !== asset.sha256.toLowerCase()) {
      throw new Error("Downloaded release checksum did not match manifest.")
    }
  }

  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, bytes)
}

async function extractArchive(archivePath: string, destination: string, format: string) {
  await mkdir(destination, { recursive: true })

  if (format === "zip") {
    if (platform() === "win32") {
      await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`,
      ])
      return
    }

    await execFileAsync("unzip", ["-q", archivePath, "-d", destination])
    return
  }

  await execFileAsync("tar", ["-xzf", archivePath, "-C", destination])
}

export async function applyUpdate() {
  const current = await getSystemVersion()

  if (!current.releaseMode && process.env.CMM_ALLOW_DEV_UPDATE !== "1") {
    throw new Error("Updates are disabled while running from a development checkout.")
  }

  const manifest = await fetchLatestManifest()
  const asset = matchingAsset(manifest)

  if (!asset) {
    throw new Error(`No update asset for ${platform()} ${arch()}.`)
  }

  if (compareVersions(manifest.version, current.version) <= 0) {
    return {
      ok: true,
      changed: false,
      version: current.version,
      message: "Already on the latest version.",
    }
  }

  const target = join(versionsDir(), manifest.version)
  const staging = `${target}.tmp-${Date.now()}`
  const format = asset.format || (platform() === "win32" ? "zip" : "tar.gz")
  const archivePath = join(
    tmpdir(),
    `${APP_NAME}-${manifest.version}.${format === "zip" ? "zip" : "tar.gz"}`
  )

  await rm(staging, { recursive: true, force: true })
  await downloadAsset(asset, archivePath)
  await extractArchive(archivePath, staging, format)
  await mkdir(dirname(activePath()), { recursive: true })
  await rm(target, { recursive: true, force: true })
  await import("node:fs/promises").then(({ rename }) => rename(staging, target))
  await writeFile(activePath(), `${target}\n`)

  setTimeout(() => {
    process.exit(0)
  }, 500)

  return {
    ok: true,
    changed: true,
    version: manifest.version,
    installPath: target,
    restartScheduled: true,
  }
}
