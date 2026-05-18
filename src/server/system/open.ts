import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export async function openLocalApp() {
  const port = process.env.NITRO_PORT || process.env.PORT || "1455"
  const url = `http://localhost:${port}`

  if (process.platform === "darwin") {
    await execFileAsync("open", [url])
  } else if (process.platform === "win32") {
    await execFileAsync("cmd", ["/c", "start", "", url])
  } else {
    await execFileAsync("xdg-open", [url])
  }

  return { ok: true, url }
}
