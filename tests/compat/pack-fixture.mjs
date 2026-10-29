import { execFile } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)

export async function packFixture(directory, archive) {
  const target = resolve(archive)
  const source = resolve(directory)
  const tar = process.platform === 'win32'
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  await execute(tar, ['-czf', './' + basename(target), '-C', dirname(source), basename(source)],
    { cwd: dirname(target), windowsHide: true })
}
