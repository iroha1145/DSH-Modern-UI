import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Whether the module at `moduleUrl` is the script Node was started with.
 *
 * Node resolves the main entry through symbolic links, so `import.meta.url` is a
 * canonical path while `process.argv[1]` keeps the spelling the caller used. A
 * plain string comparison therefore fails whenever the script is reached through
 * a link: macOS `/tmp` and `/var` (`os.tmpdir()`), or a linked home or preview
 * directory. The script would then exit 0 having done nothing.
 */
export function isMainModule(moduleUrl) {
  if (!process.argv[1]) return false
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl)) }
  catch { return false }
}
