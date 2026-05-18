import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { arch, platform } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const packageJson = JSON.parse(
  await readFile(join(root, "package.json"), "utf8")
)
const tagVersion =
  process.env.GITHUB_REF_TYPE === "tag"
    ? process.env.GITHUB_REF_NAME?.replace(/^v/i, "")
    : undefined
const version = process.env.CMM_VERSION || tagVersion || packageJson.version
const releaseRoot = join(root, "release")
const packageRoot = join(releaseRoot, "package")
const runtime = process.env.CMM_RUNTIME || "node"

if (!version) {
  throw new Error("package.json must define a version before packaging")
}

await rm(packageRoot, { recursive: true, force: true })
await mkdir(packageRoot, { recursive: true })
await cp(join(root, ".output"), join(packageRoot, ".output"), {
  recursive: true,
})
await writeFile(
  join(packageRoot, "package.json"),
  `${JSON.stringify({ ...packageJson, version }, null, 2)}\n`
)
await cp(join(root, "bun.lock"), join(packageRoot, "bun.lock"))

await writeFile(
  join(packageRoot, "runtime.json"),
  `${JSON.stringify(
    {
      name: packageJson.name,
      version,
      runtime,
      entrypoint: ".output/server/index.mjs",
      port: 1455,
      host: "127.0.0.1",
      platform: platform(),
      arch: arch(),
    },
    null,
    2
  )}\n`
)

await writeFile(
  join(releaseRoot, "codex-model-manager-manifest.template.json"),
  `${JSON.stringify(
    {
      version,
      notes: "",
      publishedAt: new Date().toISOString(),
      assets: [
        {
          platform: platform(),
          arch: arch(),
          format: platform() === "win32" ? "zip" : "tar.gz",
          url: "",
          sha256: "",
        },
      ],
    },
    null,
    2
  )}\n`
)

console.log(`Prepared release package at ${packageRoot}`)
