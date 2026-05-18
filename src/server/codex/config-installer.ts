import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

const PROVIDER_ID = "codex_model_manager"
const PROVIDER_TABLE = `[model_providers.${PROVIDER_ID}]`
const CONFIG_VALUES = {
  model_provider: PROVIDER_ID,
  name: "OpenAI",
  base_url: "http://127.0.0.1:1455/backend-api/codex",
  wire_api: "responses",
  requires_openai_auth: true,
}

function codexConfigPath() {
  return process.env.CMM_CODEX_CONFIG_PATH || join(homedir(), ".codex", "config.toml")
}

async function fileExists(path: string) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)
}

function tomlValue(value: string | boolean) {
  if (typeof value === "boolean") {
    return String(value)
  }

  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

function keyValueLine(key: string, value: string | boolean) {
  return `${key} = ${tomlValue(value)}`
}

function isTableHeader(line: string) {
  return /^\s*\[[^\]]+\]\s*$/.test(line)
}

function isKeyLine(line: string, key: string) {
  return new RegExp(`^\\s*${key}\\s*=`).test(line)
}

function upsertTopLevelModelProvider(lines: Array<string>) {
  const firstTableIndex = lines.findIndex(isTableHeader)
  const topLevelEnd = firstTableIndex === -1 ? lines.length : firstTableIndex
  const nextLines = lines.filter(
    (line, index) => index >= topLevelEnd || !isKeyLine(line, "model_provider")
  )

  nextLines.unshift(keyValueLine("model_provider", CONFIG_VALUES.model_provider))

  return nextLines
}

function upsertProviderTable(lines: Array<string>) {
  const sectionStart = lines.findIndex((line) => line.trim() === PROVIDER_TABLE)
  const providerLines = [
    PROVIDER_TABLE,
    keyValueLine("name", CONFIG_VALUES.name),
    keyValueLine("base_url", CONFIG_VALUES.base_url),
    keyValueLine("wire_api", CONFIG_VALUES.wire_api),
    keyValueLine("requires_openai_auth", CONFIG_VALUES.requires_openai_auth),
  ]

  if (sectionStart === -1) {
    return [...lines, "", ...providerLines]
  }

  const sectionEnd = lines.findIndex(
    (line, index) => index > sectionStart && isTableHeader(line)
  )
  const end = sectionEnd === -1 ? lines.length : sectionEnd
  const before = lines.slice(0, sectionStart)
  const after = lines.slice(end)

  return [...before, ...providerLines, ...after]
}

function installCodexConfig(content: string) {
  const lines = content.trim() ? content.replace(/\r\n/g, "\n").split("\n") : []
  return `${upsertProviderTable(upsertTopLevelModelProvider(lines)).join("\n").trimEnd()}\n`
}

export async function installCodexModelManagerConfig() {
  const path = codexConfigPath()
  const exists = await fileExists(path)
  const previousContent = exists ? await readFile(path, "utf8") : ""
  const nextContent = installCodexConfig(previousContent)
  const backupPath = exists ? `${path}.bak-cmm-${timestamp()}` : null

  await mkdir(dirname(path), { recursive: true })

  if (backupPath) {
    await copyFile(path, backupPath)
  }

  await writeFile(path, nextContent, "utf8")

  return {
    path,
    backupPath,
    changed: nextContent !== previousContent,
  }
}
