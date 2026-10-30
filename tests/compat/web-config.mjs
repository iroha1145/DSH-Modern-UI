import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { officialCommand, startHost } from './host.mjs'
import { isMainModule } from '../../scripts/distribution/entrypoint.mjs'
import { packFixture } from './pack-fixture.mjs'

const fixtureName = 'modern-compat-web-config-probe'
export async function runWebConfigChecks({ state, output }) {
  output = resolve(output)
  await mkdir(output, { recursive: true })
  const patchPath = join(state.home, 'profiles', state.profile, 'cordis.patch.yml')
  const originalPatch = await readFile(patchPath)
  const counts = { search: 0, fetch: 0 }
  const endpoint = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/v1/messages' && request.method === 'POST') {
      let body = ''
      for await (const chunk of request) body += chunk
      assert.equal(JSON.parse(body).model, 'controlled-search')
      counts.search++
      response.end(
        JSON.stringify({
          content: [
            { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://example.org/fixture', title: 'CONTROLLED_SEARCH_MARKER' }] },
            { type: 'text', text: 'Controlled source', citations: [{ url: 'https://example.org/fixture', cited_text: 'Controlled search excerpt' }] },
          ],
        }),
      )
    } else if (request.url === '/page') {
      counts.fetch++
      response.end(JSON.stringify({ forbidden: 'loopback fetch must never reach here' }))
    } else {
      response.statusCode = 404
      response.end('{}')
    }
  })
  await new Promise(resolve => endpoint.listen(0, '127.0.0.1', resolve))
  const directory = join(output, 'fixture', 'package')
  await mkdir(directory, { recursive: true })
  await copyFile(new URL('./web-config-probe.mjs', import.meta.url), join(directory, 'index.mjs'))
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ name: fixtureName, version: '1.0.0', type: 'module', main: './index.mjs', dsh: { bundle: { patch: './cordis.patch.yml' } } }),
  )
  await writeFile(
    join(directory, 'cordis.patch.yml'),
    JSON.stringify([
      {
        insert: [
          { id: fixtureName, name: fixtureName, config: { endpoint: `http://127.0.0.1:${endpoint.address().port}`, workspace: join(output, 'workspace') } },
        ],
      },
    ]),
  )
  const tarball = join(output, 'fixture.tgz')
  await packFixture(directory, tarball)
  const result = { version: state.officialSource.version, cli: state.cli, profile: state.profile, phases: [], passed: false }
  let host
  let installed = false
  try {
    await officialCommand(state, ['plugin', '--profile', state.profile, 'add', '--save-exact', '--ignore-scripts', tarball], join(output, 'install.log'))
    installed = true
    for (const phase of ['configure', 'enabled', 'disabled', 'provider-disabled', 'restored']) {
      host = await startHost(state, join(output, `host-${phase}.log`))
      const before = { ...counts }
      const response = await fetch(`${host.baseUrl}/api/compat-web-config/check?phase=${phase}`, {
        headers: { cookie: host.cookie },
        signal: AbortSignal.timeout(30_000),
      })
      const report = await response.json()
      result.phases.push(report)
      assert.equal(response.status, 200, JSON.stringify(report))
      assert.equal(report.passed, true)
      report.endpointDelta = { search: counts.search - before.search, fetch: counts.fetch - before.fetch }
      assert.equal(report.endpointDelta.search, phase === 'enabled' || phase === 'restored' ? 1 : 0)
      assert.equal(report.endpointDelta.fetch, 0)
      await host.stop()
      host = undefined
    }
    result.passed = true
    return result
  } finally {
    if (host) await host.stop()
    await writeFile(patchPath, originalPatch)
    try {
      if (installed) await officialCommand(state, ['plugin', '--profile', state.profile, 'remove', fixtureName], join(output, 'remove.log'))
      result.originalPatchRestored = (await readFile(patchPath)).equals(originalPatch)
      assert.ok(result.originalPatchRestored, 'Cleanup must preserve the original patch byte for byte')
    } finally {
      endpoint.closeAllConnections()
      await new Promise(resolve => endpoint.close(resolve))
      await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
    }
  }
}

if (isMainModule(import.meta.url)) {
  const [stateFile, output] = process.argv.slice(2)
  assert.ok(stateFile && output, 'Usage: node tests/compat/web-config.mjs STATE_JSON OUTPUT_DIRECTORY')
  const state = JSON.parse(await readFile(resolve(stateFile), 'utf8'))
  const result = await runWebConfigChecks({ state, output })
  console.log(JSON.stringify({ version: result.version, passed: result.passed, phases: result.phases.length, patchRestored: result.originalPatchRestored }))
}
