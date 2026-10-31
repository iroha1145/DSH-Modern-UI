import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { describe, expect, test, vi } from 'vitest'
import { type CredentialView, type JevCredentials, type JevForm, readJev, trackJev } from '../../packages/modern-ui/src/jev-settings-state.ts'

const settled = () => new Promise(resolve => setTimeout(resolve, 0))

/** A config form that accepts or refuses each write as the test says; `jev` is the accepted section. */
function hostForm(jev: Record<string, unknown> = {}) {
  const store = createSnapshotStore({ status: 'ready' as const, value: { jev } })
  const writes: { path: readonly string[]; value: unknown; accept: () => void; refuse: () => void }[] = []
  const form = {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    mutate: ops =>
      new Promise<boolean>(resolve => {
        const op = ops[0] as { path: readonly string[]; value: unknown }
        writes.push({
          ...op,
          accept: () => {
            store.set({ status: 'ready', value: { jev: { ...store.getSnapshot().value.jev, [op.path[1]]: op.value } } })
            resolve(true)
          },
          refuse: () => {
            resolve(false)
          },
        })
      }),
  } as JevForm
  return { form, writes, store }
}

/** A credentials Remote over an in-memory store; `source` is what describe reports for a stored key. */
function hostCredentials(initial: Record<string, CredentialView> = {}) {
  const views = { ...initial }
  const stored: Record<string, string> = {}
  let refuse = false
  const credentials: JevCredentials = {
    describe: vi.fn(async (refs: string[]) => ({
      ok: true as const,
      value: Object.fromEntries(refs.map(ref => [ref, views[ref] ?? { configured: false, writable: true }])),
    })),
    set: vi.fn(async (ref: string, value: string) => {
      if (refuse) return { ok: false as const, error: { code: 'credential/rejected', message: 'refused' } } as never
      stored[ref] = value
      views[ref] = { configured: true, source: 'file', writable: true }
      return { ok: true as const, value: undefined }
    }),
    unset: vi.fn(async (ref: string) => {
      delete stored[ref]
      views[ref] = { configured: false, writable: true }
      return { ok: true as const, value: undefined }
    }),
  }
  return {
    credentials,
    stored,
    refuseWrites: () => {
      refuse = true
    },
  }
}

describe('readJev', () => {
  test('defaults to on with the TYPESAFE_API_KEY reference, and refuses names the credentials service would not resolve', () => {
    expect(readJev(undefined)).toEqual({ enabled: true, ref: 'TYPESAFE_API_KEY' })
    expect(readJev({ enabled: false, credential: 'MY_JEV_KEY' })).toEqual({ enabled: false, ref: 'MY_JEV_KEY' })
    expect(readJev({ credential: 'not a ref' }).ref).toBeNull()
  })
})

describe('trackJev', () => {
  test('reports whether a key is configured and from where, without ever reading it', async () => {
    const { form } = hostForm()
    const { credentials } = hostCredentials({ TYPESAFE_API_KEY: { configured: true, source: 'env', writable: true } })
    const state = trackJev(form, credentials)
    await settled()
    expect(state.state.getSnapshot()).toMatchObject({ configured: true, source: 'env', enabled: true })
    expect(credentials.describe).toHaveBeenCalledWith(['TYPESAFE_API_KEY'])
  })

  test('saves a trimmed key under the configured reference and reports success only after the Host accepted it', async () => {
    const { form } = hostForm({ credential: 'MY_JEV_KEY' })
    const { credentials, stored } = hostCredentials()
    const state = trackJev(form, credentials)
    await settled()
    expect(await state.saveKey('  sk-test \n')).toBe(true)
    expect(stored).toEqual({ MY_JEV_KEY: 'sk-test' })
    expect(state.state.getSnapshot()).toMatchObject({ configured: true, source: 'file', busy: false, notice: 'saved' })
    expect(await state.saveKey('   ')).toBe(false)
    expect(credentials.set).toHaveBeenCalledTimes(1)
  })

  test('a refused write reads as a failure even when a key was already configured', async () => {
    const { form } = hostForm()
    const { credentials, refuseWrites } = hostCredentials({ TYPESAFE_API_KEY: { configured: true, source: 'file', writable: true } })
    const state = trackJev(form, credentials)
    await settled()
    refuseWrites()
    expect(await state.saveKey('sk-new')).toBe(false)
    expect(state.state.getSnapshot()).toMatchObject({ configured: true, notice: 'writeFailed' })
  })

  test('removes the stored key', async () => {
    const { form } = hostForm()
    const { credentials, stored } = hostCredentials()
    const state = trackJev(form, credentials)
    await state.saveKey('sk-test')
    expect(await state.removeKey()).toBe(true)
    expect(stored).toEqual({})
    expect(state.state.getSnapshot()).toMatchObject({ configured: false, notice: 'removed' })
    expect(credentials.unset).toHaveBeenCalledWith('TYPESAFE_API_KEY')
  })

  test('the switch writes jev.enabled and shows only the accepted value', async () => {
    const { form, writes } = hostForm()
    const { credentials } = hostCredentials()
    const state = trackJev(form, credentials)
    state.setEnabled(false)
    expect(writes.map(write => [write.path, write.value])).toEqual([[['jev', 'enabled'], false]])
    expect(state.state.getSnapshot().enabled).toBe(true)
    writes[0].accept()
    await settled()
    expect(state.state.getSnapshot()).toMatchObject({ enabled: false, notice: null })
    state.setEnabled(true)
    writes[1].refuse()
    await settled()
    expect(state.state.getSnapshot()).toMatchObject({ enabled: false, notice: 'switchFailed' })
  })

  test('an invalid reference name locks the key field and never reaches the credentials service', async () => {
    const { form } = hostForm({ credential: 'bad name' })
    const { credentials } = hostCredentials()
    const state = trackJev(form, credentials)
    await settled()
    expect(state.state.getSnapshot()).toMatchObject({ ref: null, writable: false })
    expect(await state.saveKey('sk-test')).toBe(false)
    expect(credentials.describe).not.toHaveBeenCalled()
    expect(credentials.set).not.toHaveBeenCalled()
  })

  test('re-reads when the Host reports a change to its reference or the configured reference changes', async () => {
    const { form, store } = hostForm()
    const { credentials } = hostCredentials()
    const state = trackJev(form, credentials)
    await settled()
    state.refresh('OTHER_KEY')
    state.refresh('TYPESAFE_API_KEY')
    store.set({ status: 'ready', value: { jev: { credential: 'MY_JEV_KEY' } } })
    await settled()
    expect((credentials.describe as ReturnType<typeof vi.fn>).mock.calls.map(call => call[0])).toEqual([
      ['TYPESAFE_API_KEY'],
      ['TYPESAFE_API_KEY'],
      ['MY_JEV_KEY'],
    ])
    state.dispose()
  })
})
