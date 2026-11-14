/** Real DSH + the working-tree plugin, in a dedicated home with a local scripted model. */
import { execFile, spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { ensurePreviewDependency } from './preview-dependency.mjs'

const options = new Map()
for (let at = 2; at < process.argv.length; at += 2) {
  const key = process.argv[at]
  if (!['--repo', '--root', '--demo'].includes(key) || !process.argv[at + 1])
    throw new Error('Usage: dev-layout-preview.mjs [--repo path] [--root path] [--demo surfaces]')
  options.set(key, process.argv[at + 1])
}
const repo = path.resolve(options.get('--repo') ?? path.resolve(import.meta.dirname, '..'))
const root = path.resolve(options.get('--root') ?? path.join(repo, '.artifacts/layout-preview'))
if (options.has('--demo') && options.get('--demo') !== 'surfaces') throw new Error('Unknown demo; use --demo surfaces')
const home = path.join(root, 'home')
const workspace = path.join(root, 'workspace')
const fixture = path.join(root, 'model')
const cli = path.join(repo, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const execute = promisify(execFile)
const environment = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1', COMPAT_OFFICIAL_CLI: cli, DEMO_WORKSPACE: workspace }
for (const key of Object.keys(environment)) if (/API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET_KEY|NODE_PATH|NODE_OPTIONS/i.test(key)) delete environment[key]
const ownerPath = path.join(root, 'preview-owner.json')
const owner = await readFile(ownerPath, 'utf8').catch(error => {
  if (error.code === 'ENOENT') return null
  throw error
})
if (owner && JSON.parse(owner).repo !== repo) throw new Error(`Preview root belongs to another checkout; choose a separate --root: ${root}`)
await Promise.all([home, workspace, fixture].map(directory => mkdir(directory, { recursive: true })))
await writeFile(ownerPath, JSON.stringify({ repo }, null, 2))
console.log('Building Modern UI for the isolated layout preview…')
await execute(process.execPath, [path.join(repo, 'scripts/build-plugin.mjs')], { cwd: repo, env: environment, windowsHide: true, timeout: 180_000 })
await execute(process.execPath, [cli, '--profile', 'web', '--dump-default-config'], { cwd: root, env: environment, windowsHide: true })

let answer = [
  '## 给长回答一个更舒展的阅读空间',
  '',
  '这个预览运行的是真正的 DSH 和当前工作区里的 Modern UI。在「设置 → 通用 → 对话宽度」可以选择「阅读」「标准」「宽屏」或「自定义」。只有选择「自定义」才会临时出现调节线，松手后自动隐藏。标题、正文、列表与输入框围绕同一条中心轴排列，正文不再在居中的消息列内部单独按 65ch 收窄。',
  '',
  '一份 Agent 回答往往同时包含解释、步骤、代码和表格。解释需要连续阅读，代码需要保留结构，表格需要横向比较。现在可以按当前任务选择宽度：阅读档适合专心看说明，标准档适合日常协作，宽屏档适合检查代码或比较多列内容。手动调宽会立即生效，刷新后也会记住选择。',
  '',
  '## 三种宽度，用于三种工作状态',
  '',
  '- **阅读**：680 px，让中文长文保持适度行长，标题和列表共用正文的起始位置。',
  '- **标准**：840 px，作为默认档位，给解释与代码都留出空间。',
  '- **宽屏**：1040 px，在大窗口中更充分地利用横向空间。',
  '',
  '> 窗口变窄、打开侧栏或切换到手机尺寸时，会按实际会话面板自动收缩。空间恢复后，原来的桌面宽度仍然保留。',
  '',
  '## 用一段代码和一张表检查布局',
  '',
  '```ts',
  'const widths = { reading: 680, standard: 840, wide: 1040 }',
  '',
  'function conversationWidth(mode: keyof typeof widths, available: number) {',
  '  return Math.min(widths[mode], available)',
  '}',
  '```',
  '',
  '| 使用场景 | 阅读 | 标准 | 宽屏 |',
  '| --- | --- | --- | --- |',
  '| 连续阅读中文长文 | 较集中 | 适中 | 按个人偏好 |',
  '| 查看较长代码 | 可以横向滚动 | 日常查看 | 留出更多横向空间 |',
  '| 对比表格与多项方案 | 信息集中 | 平衡 | 适合横向比较 |',
  '| 窄窗口或并排预览 | 自动收缩 | 自动收缩 | 自动收缩 |',
  '',
  '## 试着按自己的习惯调整',
  '',
  '选择「自定义」并关闭设置后，拖动左侧或右侧的细线，内容会围绕中心轴同步展开；松手就保存并隐藏灰线。也可以选中细线，用方向键微调，按 Home 或 End 调到最小或最大宽度，按 Enter 完成或 Escape 取消。切换预设会保留上次的自定义宽度，再次选择「自定义」即可继续调整。',
  '',
  '这份预览使用本地固定的示例回答，不会调用外部模型，也不会读取日常 DSH 的会话或密钥。可以继续发送消息，观察相同结构的长回答在三种宽度下如何排版。',
].join('\n')
if (options.get('--demo') === 'surfaces') answer = await readFile(new URL('./fixtures/surface-preview.md', import.meta.url), 'utf8')
let provider = await readFile(path.join(repo, 'tests/compat/fixtures/demo-provider.mjs'), 'utf8')
const begin = provider.indexOf('const overview = ')
const end = provider.indexOf('\n\nconst textOf', begin)
if (begin < 0 || end < 0) throw new Error('The local demo model fixture changed; update its preview adapter')
provider = provider.slice(0, begin) + 'const overview = ' + JSON.stringify(answer) + provider.slice(end)
await writeFile(path.join(fixture, 'index.mjs'), provider)
const name = 'modern-layout-demo'
await writeFile(
  path.join(fixture, 'package.json'),
  JSON.stringify({ name, version: '1.0.0', type: 'module', main: './index.mjs', dsh: { bundle: { patch: './cordis.patch.yml' } } }, null, 2),
)
await writeFile(path.join(fixture, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: name, name }] }]))

const profile = path.join(home, 'profiles/web')
const manifestPath = path.join(profile, 'package.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
for (const [name, target] of [
  ['@iroha1145/dsh-modern-ui', path.join(repo, 'packages/modern-ui')],
  ['modern-layout-demo', fixture],
]) {
  const destination = path.join(profile, 'node_modules', name)
  await mkdir(path.dirname(destination), { recursive: true })
  await ensurePreviewDependency(target, destination)
  manifest.dependencies[name] = 'link:' + target.replaceAll('\\', '/')
  if (!manifest.dsh.profile.bundles.includes(name)) manifest.dsh.profile.bundles.push(name)
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
const overlay = path.join(root, 'preview.patch.json')
await writeFile(
  overlay,
  JSON.stringify([
    { id: 'schedule', disabled: true },
    { id: 'agent-default-model', config: { provider: 'demo-local-model', model: 'demo-reasoner' } },
    { id: 'workspace-controller', config: { documentsDirectory: path.join(root, 'documents') } },
  ]),
)

const child = spawn(process.execPath, [cli, '--profile', 'web', '--patch', overlay, '--host', '127.0.0.1', '--port', '0', '--no-open'], {
  cwd: workspace,
  env: environment,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
let announced = false
const collect = bytes => {
  log += bytes
  const match = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\S*)/.exec(log)
  if (!announced && match) {
    announced = true
    console.log(`LAYOUT_PREVIEW_URL=${match[1]}`)
    void writeFile(path.join(root, 'preview-url.txt'), match[1])
    console.log(`Preview home: ${home}`)
  }
}
child.stdout.on('data', collect)
child.stderr.on('data', collect)
child.once('error', error => {
  console.error(error.message)
  process.exitCode = 1
})
await writeFile(path.join(root, 'preview-processes.json'), JSON.stringify({ launcher: process.pid, host: child.pid, repo, root }, null, 2))
child.once('exit', code => {
  void writeFile(path.join(root, 'host.log'), log.replace(/([?&]token=)[^\s&]+/g, '$1[redacted]'))
  if (!announced) console.error(log.replace(/([?&]token=)[^\s&]+/g, '$1[redacted]'))
  process.exitCode = code ?? 0
})
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    child.kill('SIGTERM')
  })
