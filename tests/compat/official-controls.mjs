import assert from 'node:assert/strict'
import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A published class is its CSS module's build hash plus the local name: `_local_hash_line` in the Web
 * frontend, `hash_local` in the client plugin bundles. A release that edits a module changes that hash. */
function parseClass(name) {
  const web = /^_(.+)_([a-z0-9]{5})_\d+$/.exec(name)
  if (web) return { module: web[2], local: web[1] }
  const client = /^([\w-]{6})_(.+)$/.exec(name)
  assert.ok(client, `Unrecognised official class name ${name}`)
  return { module: client[1], local: client[2] }
}

/** Read the stylesheet's selector contract. A target is one official class; where releases name it
 * differently, the rule lists the names together in one `:is()`. Targets are grouped by official
 * module, and every target of a renamed module must carry a name for each of that module's builds. */
export function readSelectorContract(css) {
  const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/body\[data-modern-official-controls\]([^{}]+)\{/g)].map(match => match[1])
  assert.ok(
    selectors.every(selector => !selector.includes('[class*=')),
    'No broad substring matching',
  )
  const written = new Map()
  const record = (names, selector) => {
    for (const name of names) {
      const previous = written.get(name)
      assert.ok(!previous || previous.join() === names.join(), `${name} is written with different alternatives in "${selector.trim()}"`)
      written.set(name, previous ?? names)
    }
  }
  for (const selector of selectors) {
    const rest = selector.replace(/:is\(([^()]*)\)/g, (_, list) => {
      const items = list.split(',').map(item => item.trim())
      assert.ok(items.length > 1 && items.every(item => /^\.[\w-]+$/.test(item)), `:is() may only list alternative class names: "${selector.trim()}"`)
      record(
        items.map(item => item.slice(1)),
        selector,
      )
      return ''
    })
    assert.ok(!rest.includes(':is('), `:is() may only list alternative class names: "${selector.trim()}"`)
    for (const match of rest.matchAll(/\.([\w-]+)/g)) record([match[1]], selector)
  }
  const targets = [...new Set(written.values())]
  const byBuild = new Map()
  for (const names of targets) {
    const parsed = names.map(parseClass)
    assert.equal(new Set(parsed.map(item => item.local)).size, 1, `Alternatives must name the same official class: ${names.join(', ')}`)
    assert.equal(new Set(parsed.map(item => item.module)).size, names.length, `Alternatives must come from different builds of a module: ${names.join(', ')}`)
    const joined = parsed.map(item => byBuild.get(item.module)).filter(Boolean)
    const group = {
      builds: new Set([...parsed.map(item => item.module), ...joined.flatMap(other => [...other.builds])]),
      targets: new Set([names, ...joined.flatMap(other => [...other.targets])]),
    }
    for (const build of group.builds) byBuild.set(build, group)
  }
  // Keep the stylesheet's order, so a report lists classes the way the rules read.
  const modules = [...new Set(byBuild.values())].map(group => {
    const own = targets.filter(names => group.targets.has(names))
    return { builds: [...new Set(own.flatMap(names => names.map(name => parseClass(name).module)))], targets: own }
  })
  for (const group of modules) {
    for (const names of group.targets) {
      const missing = group.builds.filter(build => !names.some(name => parseClass(name).module === build))
      assert.equal(missing.length, 0, `${names.join(', ')} has no name for module build ${missing.join(', ')}, which other rules of that module target`)
    }
  }
  return { targets, names: [...written.keys()].sort(), modules }
}

/** Check exact selectors against the consumer's actual official release, without a test runner. */
export async function runOfficialControlsChecks(backendPackage, options = {}) {
  const driver = createRequire(path.join(process.env.COMPAT_TEST_DRIVER ?? root, 'package.json'))
  const ts = driver('typescript')
  const backend = realpathSync(backendPackage)
  const consumer = createRequire(backend)
  const version = JSON.parse(readFileSync(backend, 'utf8')).version
  const frontend = consumer.resolve('@deepseek-ai/dsh-web-frontend/package.json')
  assert.equal(JSON.parse(readFileSync(frontend, 'utf8')).version, version)
  const queue = [backend]
  const packages = new Map()
  while (queue.length) {
    const filename = realpathSync(queue.shift())
    if (packages.has(filename)) continue
    const metadata = JSON.parse(readFileSync(filename, 'utf8'))
    packages.set(filename, metadata)
    const local = createRequire(filename)
    for (const name of Object.keys(metadata.dependencies ?? {}).filter(name => name.startsWith('@deepseek-ai/'))) {
      queue.push(local.resolve(name + '/package.json'))
    }
  }
  const files = []
  function collect(directory, owner) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory()) collect(filename, owner)
      else if (/\.(?:js|css)$/.test(entry.name)) files.push({ owner, filename, text: readFileSync(filename, 'utf8') })
    }
  }
  for (const [filename, metadata] of packages) {
    if (!/^@deepseek-ai\/dsh-(?:web-frontend|client)/.test(metadata.name)) continue
    const directory = path.dirname(filename)
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ['lib', 'dist'].includes(entry.name)) collect(path.join(directory, entry.name), metadata)
    }
  }
  const contract = readSelectorContract(readFileSync(options.cssPath ?? path.join(root, 'packages/modern-ui/src/official-controls.css'), 'utf8'))
  assert.deepEqual(
    { targets: contract.targets.length, names: contract.names.length },
    { targets: 49, names: 66 },
    'Review and document every change to the private selector contract',
  )

  // A class counts as published when the release ships both its CSS rule and the runtime mapping that applies it.
  const inspect = name => {
    const rule = new RegExp('\\.' + escapeRegex(name) + '(?![\\w-])')
    const mapping = new RegExp('(?:["\\\'][\\w$-]+["\\\']|[\\w$]+)\\s*[:=]\\s*["\\\']' + escapeRegex(name) + '["\\\']')
    const styles = files.filter(file => file.text.includes(name) && rule.test(file.text))
    const runtime = files.filter(file => file.filename.endsWith('.js') && file.text.includes(name) && mapping.test(file.text))
    const gaps = [!styles.length && 'CSS rule', !runtime.length && 'runtime mapping'].filter(Boolean)
    return { name, sources: [...styles, ...runtime], missing: gaps.length === 2 ? name : gaps.length ? `${name} (no ${gaps[0]})` : undefined }
  }
  // The running release must publish one complete build of every module the stylesheet targets. A module
  // without one is reported with every class it lacks, per build, so one run names the whole gap.
  const classes = []
  const modules = []
  const lacking = []
  const mixed = []
  for (const group of contract.modules) {
    const builds = group.builds.map(build => ({ build, classes: group.targets.map(names => inspect(names.find(name => parseClass(name).module === build))) }))
    const published = builds.find(candidate => candidate.classes.every(item => !item.missing))
    if (builds.length > 1) modules.push({ builds: group.builds, published: published?.build ?? null })
    if (!published) {
      const lists = builds.map(candidate => candidate.classes.flatMap(item => item.missing ?? []).join(', '))
      lacking.push(lists.length > 1 ? lists.map(list => `(${list})`).join(' or ') : lists[0])
      continue
    }
    for (const item of published.classes) {
      classes.push(item.name)
      for (const file of item.sources) if (file.owner.version !== version) mixed.push(`${item.name} in ${file.owner.name}@${file.owner.version}`)
    }
  }
  if (lacking.length) assert.fail(`${version}: official classes missing from the published CSS or runtime mappings: ${lacking.join('; ')}`)
  assert.deepEqual(mixed, [], `${version}: official classes come from packages of another version`)

  // Older hosts ship primitives inside the Web frontend rather than as a runtime dependency.
  // Inspect that release's actual built React calls for the selector-relevant DOM contract.
  let switches = 0
  let accountMenus = 0
  for (const file of files.filter(file => file.filename.endsWith('.js'))) {
    if (!file.text.includes('_switch_1ik0f_5') && !file.text.includes('yHnPSG_signedOutMenu')) continue
    const source = ts.createSourceFile(file.filename, file.text, ts.ScriptTarget.Latest, true)
    const properties = node => new Map(node.properties.filter(ts.isPropertyAssignment).map(property => [property.name.text, property.initializer]))
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        node.arguments.length >= 2 &&
        ts.isStringLiteral(node.arguments[0]) &&
        node.arguments[0].text === 'button' &&
        ts.isObjectLiteralExpression(node.arguments[1])
      ) {
        const props = properties(node.arguments[1])
        if (props.get('role')?.text === 'switch') {
          assert.ok(props.has('aria-checked') && props.has('aria-label') && props.has('disabled'), 'Switch state and naming attributes')
          assert.ok(/\.switch\b/.test(props.get('className')?.getText(source)), 'Switch class is applied to button')
          const child = props.get('children')
          assert.ok(child && ts.isCallExpression(child) && child.arguments[0]?.text === 'span', 'Switch thumb remains a direct span child')
          const thumb = properties(child.arguments[1]).get('className')
          assert.ok(thumb && /\.thumb\b/.test(thumb.getText(source)), 'Thumb class is applied to the direct span')
          switches++
        }
      }
      if (ts.isPropertyAssignment(node) && node.name.text === 'listClassName' && /\.signedOutMenu\b/.test(node.initializer.getText(source))) accountMenus++
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  assert.ok(switches > 0, 'Published button switch structure must be present')
  assert.ok(accountMenus > 0, 'Published account Menu must apply signedOutMenu to its list')
  const published = files.map(file => file.text).join('\n')
  assert.ok(/signedOutMenu\[role=menu\]/.test(published))
  assert.ok(/signedOutMenu \[role=menuitem\]/.test(published))
  return { version, classes: classes.sort(), modules, structures: { switches, accountMenus } }
}
