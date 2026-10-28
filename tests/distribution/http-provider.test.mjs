import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { connect } from 'node:net'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { brotliCompressSync } from 'node:zlib'
import { getGlobalDispatcher } from 'undici'
import { HttpFetchProvider } from '../../packages/modern-ui/src/host-compat/web-fetch-http/index.mjs'

const limits = { maxResponseBytes: 4096, maxBodyChars: 4096, timeoutMs: 2000, maxRedirects: 2, userAgent: 'fixture' }

test('rc4 public-address, DNS pinning, NAT64 and provider logic remains unchanged', async () => {
  const originalBytes = await readFile(new URL('../../node_modules/@deepseek-ai/dsh-web-fetch-http/lib/index.js', import.meta.url))
  assert.equal(createHash('sha256').update(originalBytes).digest('hex'), '489fef91b0c11c063029ea7aed27b312817570b9c3177aeaa44983b9a25aedcd')
  const original = originalBytes.toString().replaceAll('\r\n', '\n')
  const current = (await readFile(new URL('../../packages/modern-ui/src/host-compat/web-fetch-http/index.mjs', import.meta.url), 'utf8')).replaceAll('\r\n', '\n').split('\n').slice(2).join('\n')
  const suffix = '/** Production network operations'
  assert.equal(current.slice(0, current.indexOf('/** Use the resolved proxy')), original.slice(0, original.indexOf('/**\n* Fetch through the dispatcher')))
  assert.equal(current.slice(current.indexOf(suffix)), original.slice(original.indexOf(suffix))
    .replace('requestVia(route.dispatcher, url, headers, signal)', 'requestVia(route.proxy, url, headers, signal)')
    .replace('const name = "web-fetch-http";', 'const name = "modern-ui-web-fetch-http";'))
})

test('default provider refuses local destinations before connecting', async () => {
  const provider = new HttpFetchProvider(limits)
  for (const host of ['127.0.0.1', '10.0.0.1', '[::1]', '169.254.169.254']) {
    await assert.rejects(provider.fetch({ url: `http://${host}/` }), { code: 'WEB_BLOCKED_URL' })
  }
})

test('private pinned transport preserves redirects, malformed-body recovery, caps and global dispatcher', async t => {
  let forbiddenHits = 0
  const server = createServer((request, response) => {
    if (request.url === '/redirect') { response.writeHead(302, { location: '/ok' }); response.end(); return }
    if (request.url === '/cross') { response.writeHead(302, { location: `http://other.invalid:${server.address().port}/forbidden` }); response.end(); return }
    if (request.url === '/forbidden') forbiddenHits++
    if (request.url === '/gzip') { response.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' }); response.end('not gzip'); return }
    if (request.url === '/large') { response.writeHead(200, { 'content-type': 'text/plain', 'content-length': '5000' }); response.end('x'.repeat(5000)); return }
    if (request.url === '/brotli') { response.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'br' }); response.end(brotliCompressSync(Buffer.from('healthy Brotli'))); return }
    response.writeHead(200, { 'content-type': 'text/plain' }); response.end('healthy')
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const base = `http://fixture.invalid:${server.address().port}`
  // This public constructor seam replaces only DNS resolution in the local test.
  const provider = new HttpFetchProvider(limits, async () => [{ address: '127.0.0.1', family: 4 }])
  const dispatcher = getGlobalDispatcher()
  assert.equal((await provider.fetch({ url: `${base}/redirect` })).body.content, 'healthy')
  await assert.rejects(provider.fetch({ url: `${base}/cross` }), { code: 'WEB_REDIRECT_BLOCKED' })
  assert.equal(forbiddenHits, 0)
  await assert.rejects(provider.fetch({ url: `${base}/gzip` }), { code: 'WEB_PROVIDER_ERROR' })
  await assert.rejects(provider.fetch({ url: `${base}/large` }), { code: 'WEB_FETCH_TOO_LARGE' })
  assert.equal((await provider.fetch({ url: `${base}/brotli` })).body.content, 'healthy Brotli')
  assert.equal(getGlobalDispatcher(), dispatcher)
})

test('proxy route uses a private pinned ProxyAgent without changing the official dispatcher', async () => {
  const target = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('via proxy') })
  const proxy = createServer((request, response) => {
    connections++
    assert.equal(request.url, 'http://fixture.invalid/page')
    response.writeHead(200, { 'content-type': 'text/plain' }); response.end('via proxy')
  })
  const sockets = new Set()
  let connections = 0
  proxy.on('connect', (_request, client, head) => {
    connections++
    const upstream = connect(target.address().port, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      client.pipe(upstream); upstream.pipe(client)
    })
    for (const socket of [client, upstream]) { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => socket.destroy()) }
  })
  target.listen(0, '127.0.0.1'); proxy.listen(0, '127.0.0.1')
  await Promise.all([once(target, 'listening'), once(proxy, 'listening')])
  let dispose
  try {
    dispose = await installProxyFromEnvironment({ get: name => name === 'HTTP_PROXY' ? { value: `http://127.0.0.1:${proxy.address().port}` } : undefined }, () => {})
    const official = getGlobalDispatcher()
    const provider = new HttpFetchProvider(limits, async () => { throw new Error('Proxy should resolve the public hostname') })
    assert.equal((await provider.fetch({ url: 'http://fixture.invalid/page' })).body.content, 'via proxy')
    assert.equal(connections, 1)
    assert.equal(getGlobalDispatcher(), official)
  } finally {
    for (const socket of sockets) socket.destroy()
    target.closeAllConnections(); proxy.closeAllConnections()
    await Promise.all([new Promise(resolve => target.close(resolve)), new Promise(resolve => proxy.close(resolve))])
    await dispose?.()
  }
})
