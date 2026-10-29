import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { API, PROBE, TARGET, MODERN, NULLABLE, DISABLED, PING, LABELS, toolName } from './protocol.mjs'

export const inject = ['connection', 'profileContext', 'pluginManager', 'loader', 'tools']

export function apply(ctx) {
  const generation = randomUUID()
  const counts = Object.fromEntries(LABELS.map(label => [label, { active: 0, mounts: 0, unmounts: 0, pings: 0, maxActive: 0 }]))
  ctx.provide('compatLifecycle', {
    mount(label) {
      const count = counts[label]
      count.active++; count.mounts++; count.maxActive = Math.max(count.maxActive, count.active)
      return () => { count.active--; count.unmounts++ }
    },
    ping(label) { counts[label].pings++ },
  })
  const targetTarball = fileURLToPath(new URL('./fixtures/target.tgz', import.meta.url))
  const digest = value => createHash('sha256').update(value).digest('hex')
  const state = async () => {
    const profile = ctx.profileContext
    const manifest = JSON.parse(await readFile(path.join(profile.dir, 'package.json'), 'utf8'))
    const withoutBundles = structuredClone(manifest)
    delete withoutBundles.dsh.profile.bundles
    const rows = [...ctx.loader.entries()]
      .filter(entry => [NULLABLE, DISABLED].includes(entry.options.id))
      .map(entry => structuredClone(entry.options))
      .sort((left, right) => left.id.localeCompare(right.id))
    return {
      generation, profile: { name: profile.name, dir: profile.dir },
      plugins: await ctx.pluginManager.listPlugins(), bundles: await ctx.pluginManager.listBundles(),
      counts: structuredClone(counts), tools: Object.fromEntries(LABELS.map(label => [label, ctx.tools.get(toolName(label)) !== undefined])),
      preservedRows: rows, patchSha256: digest(await readFile(profile.patchPath)),
      manifestWithoutBundlesSha256: digest(JSON.stringify(withoutBundles)),
      targetInstalled: Object.hasOwn(manifest.dependencies ?? {}, TARGET),
      probeSelected: manifest.dsh.profile.bundles.includes(PROBE),
    }
  }
  const route = (suffix, methods, action) => ctx.effect(() => ctx.connection.fetch.register({
    path: `${API}/${suffix}`, methods, requestBody: 'buffered',
    fetch: async request => {
      try { return Response.json(await action(request), { headers: { 'Cache-Control': 'no-store' } }) }
      catch (error) { return Response.json({ error: error.message }, { status: 500 }) }
    },
  }))
  const enabled = async request => {
    const body = await request.json()
    if (typeof body.enabled !== 'boolean') throw new Error('Fixture enablement must be boolean')
    return body.enabled
  }
  route('state', ['GET'], state)
  route('ping', ['POST'], () => {
    const before = Object.fromEntries(LABELS.map(label => [label, counts[label].pings]))
    ctx.emit(PING)
    return { delta: Object.fromEntries(LABELS.map(label => [label, counts[label].pings - before[label]])) }
  })
  route('target/install', ['POST'], () => ctx.pluginManager.installBundle(targetTarball, { saveExact: true }))
  route('target/enabled', ['POST'], async request => {
    const desired = await enabled(request)
    const entries = (await ctx.pluginManager.listPlugins()).filter(entry => entry.moduleName === TARGET)
    if (entries.length !== 1) throw new Error('Expected one addressable lifecycle target')
    return ctx.pluginManager.setPluginEnabled(entries[0].entryId, desired)
  })
  route('target/remove', ['POST'], () => ctx.pluginManager.removeBundle(TARGET))
  route('modern/enabled', ['POST'], async request => ctx.pluginManager.setBundleEnabled(MODERN, await enabled(request)))
}
