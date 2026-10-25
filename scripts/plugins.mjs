#!/usr/bin/env node
// Install the community plugins listed in dsh-ui.json into a DSH profile, once.
//
// A plugin counts as installed when <DSH_HOME>/profiles/<profile>/node_modules/<name>/package.json
// exists. The same version is skipped; another version is reported and left alone; a plugin the
// profile declares but whose files are missing is reported and left alone. Only plugins that are
// absent are installed, in one `dsh plugin add --save-exact` call, and then checked again.
//
// Usage: node plugins.mjs --dsh <dsh checkout> --home <DSH_HOME> [--profile web]
//                         [--manifest dsh-ui.json] [--check]
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const options = { profile: undefined, manifest: join(here, '..', 'dsh-ui.json'), check: false }
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    const value = () => {
      const next = argv[++index]
      if (next === undefined) fail(`${flag} 需要一个值`)
      return next
    }
    if (flag === '--dsh') options.dsh = resolve(value())
    else if (flag === '--home') options.home = resolve(value())
    else if (flag === '--profile') options.profile = value()
    else if (flag === '--manifest') options.manifest = resolve(value())
    else if (flag === '--check') options.check = true
    else fail(`不认识的参数 ${flag}`)
  }
  if (options.home === undefined) fail('缺少 --home')
  if (!options.check && options.dsh === undefined) fail('缺少 --dsh')
  return options
}

function fail(message) {
  process.stderr.write(`plugins: ${message}\n`)
  process.exit(1)
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * The store a profile's node_modules was linked from, when pnpm would now use another one.
 * pnpm refuses to add packages in that state (ERR_PNPM_UNEXPECTED_STORE), so it is caught first.
 */
function strayStore(profileDir) {
  const modules = join(profileDir, 'node_modules', '.modules.yaml')
  if (!existsSync(modules)) return undefined
  // pnpm writes this file as JSON; the pattern also accepts a YAML `storeDir:` line.
  const match = /^\s*"?storeDir"?\s*:\s*"?([^"\n]+?)"?\s*,?\s*$/m.exec(readFileSync(modules, 'utf8'))
  const recorded = match?.[1]
  if (recorded === undefined) return undefined
  const current = spawnSync('pnpm', ['store', 'path'], { cwd: profileDir, encoding: 'utf8', shell: process.platform === 'win32' })
  // The path is the last line; pnpm may print notices above it.
  const active = current.status === 0 ? current.stdout.trim().split(/\r?\n/).at(-1)?.trim() : undefined
  if (active === undefined) return existsSync(recorded) ? undefined : { recorded, active: '（pnpm 没有回答）' }
  return resolve(recorded) === resolve(active) ? undefined : { recorded, active }
}

function survey(profileDir, plugins) {
  const manifest = readJson(join(profileDir, 'package.json')) ?? {}
  const declared = { ...manifest.dependencies, ...manifest.devDependencies }
  const bundles = manifest.dsh?.profile?.bundles ?? []
  return plugins.map((plugin) => {
    const installed = readJson(join(profileDir, 'node_modules', plugin.name, 'package.json'))
    const isBundle = installed?.dsh?.bundle !== undefined
    let state
    if (installed?.version === plugin.version) state = 'same'
    else if (installed !== undefined) state = 'other'
    else if (declared[plugin.name] !== undefined) state = 'declared'
    else state = 'missing'
    return {
      ...plugin,
      state,
      installedVersion: installed?.version,
      declaredSpec: declared[plugin.name],
      listed: !isBundle || bundles.includes(plugin.name),
    }
  })
}

function report(rows) {
  for (const row of rows) {
    if (row.state === 'same') {
      const note = row.listed ? '' : '（文件在，但还没加进这个配置的插件列表）'
      console.log(`  已安装 ${row.name}@${row.installedVersion}，跳过${note}`)
    } else if (row.state === 'other') {
      console.log(`  已安装 ${row.name}@${row.installedVersion}，和测试过的 ${row.version} 不同，保持原样不覆盖`)
    } else if (row.state === 'declared') {
      console.log(`  ${row.name} 在配置里声明为 ${row.declaredSpec}，但文件不在，保持原样；先在该配置目录修好依赖再重跑`)
    } else {
      console.log(`  待安装 ${row.name}@${row.version}`)
    }
  }
}

const options = parseArgs(process.argv.slice(2))
const manifest = readJson(options.manifest)
if (manifest === undefined) fail(`读不了 ${options.manifest}`)
const profile = options.profile ?? manifest.profile ?? 'web'
const profileDir = join(options.home, 'profiles', profile)
const plugins = manifest.plugins ?? []

console.log(`插件（配置 ${profile}，目录 ${profileDir}）：`)
const before = survey(profileDir, plugins)
report(before)
const missing = before.filter(row => row.state === 'missing')
if (options.check || missing.length === 0) {
  if (missing.length === 0) console.log('  没有需要安装的插件')
  process.exit(0)
}

const store = strayStore(profileDir)
if (store !== undefined) {
  const launcher = join(dirname(options.dsh), process.platform === 'win32' ? 'dsh-ui.cmd' : 'dsh-ui')
  fail([
    `这个配置的依赖是从 ${store.recorded} 链接的，现在的 pnpm 用的是 ${store.active}，`,
    '直接安装会被 pnpm 拒绝（ERR_PNPM_UNEXPECTED_STORE），所以没有动它。',
    `修复办法：先备份 ${profileDir}，删掉其中的 node_modules，运行 ${launcher} plugin --profile ${profile} install 重新装好依赖，再重跑安装脚本。`,
  ].join('\n'))
}

const specs = missing.map(row => `${row.name}@${row.version}`)
console.log(`安装 ${specs.join(' ')} …`)
const loader = join(options.dsh, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs')
const cli = join(options.dsh, 'apps', 'cli', 'src', 'bin.ts')
if (!existsSync(loader) || !existsSync(cli)) fail(`${options.dsh} 不是装好的 DSH 目录（找不到 tsx 或 apps/cli）`)
const result = spawnSync(process.execPath, [
  '--import', pathToFileURL(loader).href, cli, 'plugin', '--profile', profile, 'add', '--save-exact', ...specs,
], {
  cwd: homedir(),
  stdio: 'inherit',
  env: { ...process.env, DSH_HOME: options.home, TSX_TSCONFIG_PATH: join(options.dsh, 'tsconfig.json') },
})
if (result.status !== 0) fail(`dsh plugin 安装失败（退出码 ${result.status ?? result.signal}）`)

const after = survey(profileDir, missing)
const broken = after.filter(row => row.state !== 'same' || !row.listed)
for (const row of after) {
  console.log(`  ${row.state === 'same' && row.listed ? '✓' : '✗'} ${row.name}@${row.installedVersion ?? '未安装'}${row.listed ? '' : '（未加入插件列表）'}`)
}
if (broken.length > 0) fail('有插件没装好，见上面的列表')
console.log('插件装好了，重启 DSH 后生效')
