import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasOwnerSteeringBatch, waitForOwnerStreamRelease } from './fixtures/owner-stream-barrier.mjs'

test('model barrier needs both release and real inbox admission, in either order', async () => {
  for (const releaseFirst of [false, true]) {
    let released = releaseFirst, admitted = !releaseFirst, settled = false
    const pending = waitForOwnerStreamRelease({ released: () => released, admitted: () => admitted }).then(() => { settled = true })
    await new Promise(resolve => setTimeout(resolve, 45))
    assert.equal(settled, false)
    released = admitted = true
    await pending
    assert.equal(settled, true)
  }
})

test('stop really aborts an unreleased stream independently of steering readiness', async () => {
  const controller = new AbortController()
  let observed
  const pending = waitForOwnerStreamRelease({ signal: controller.signal, released: () => false, admitted: () => false,
    onAbort: reason => { observed = reason } })
  const reason = { kind: 'user' }
  controller.abort(reason)
  await assert.rejects(pending, error => error === reason)
  assert.equal(observed, reason)
})

test('batch readiness matches both exact actual inbox message bodies', () => {
  const message = text => ({ content: [{ type: 'text', text }] })
  assert.equal(hasOwnerSteeringBatch([message('OWNER_STEER_FIRST')]), false)
  assert.equal(hasOwnerSteeringBatch([message('OWNER_STEER_FIRST'), message('OWNER_STEER_SECOND')]), true)
  assert.equal(hasOwnerSteeringBatch([message('OWNER_STEER_FIRST OWNER_STEER_SECOND')]), false)
})
