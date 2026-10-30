import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { describe, expect, test } from 'vitest'
import { type PresentationForm, trackPresentation } from '../../packages/modern-ui/src/presentation-switches.ts'

/**
 * A config form with the official controller's write contract: `mutate` resolves true once the accepted
 * view is in the snapshot, resolves false after a refused write reloads the (unchanged) accepted state, and
 * rejects when the settings call never reaches the Host. Each write waits until the test settles it.
 */
function hostForm(prompt: boolean) {
  const accepted = (value: boolean) => ({ status: 'ready' as const, value: { presentation: { prompt: value, openui: true, followups: true } } })
  const store = createSnapshotStore(accepted(prompt))
  const writes: { value: boolean; accept: () => void; refuse: () => void; fail: () => void }[] = []
  const form = {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    mutate: ops =>
      new Promise<boolean>((resolve, reject) => {
        const value = (ops[0] as { value: boolean }).value
        writes.push({
          value,
          accept: () => {
            store.set(accepted(value))
            resolve(true)
          },
          refuse: () => {
            store.set(accepted(store.getSnapshot().value.presentation.prompt))
            resolve(false)
          },
          fail: () => {
            reject(new Error('settings transport failure'))
          },
        })
      }),
  } as PresentationForm
  /** A change accepted through another window or the Host itself. */
  const changeElsewhere = (value: boolean) => {
    store.set(accepted(value))
  }
  return { form, writes, changeElsewhere }
}

const settled = () => new Promise(resolve => setTimeout(resolve, 0))

describe('presentation prompt switch', () => {
  test('a write shows only once the Host accepts it', async () => {
    const { form, writes } = hostForm(true)
    const state = trackPresentation(form)
    state.setPrompt(false)
    expect(writes.map(write => write.value)).toEqual([false])
    expect(state.settings.getSnapshot().prompt).toBe(true)
    writes[0].accept()
    await settled()
    expect(state.settings.getSnapshot().prompt).toBe(false)
    expect(state.saveFailed.getSnapshot()).toBe(false)
  })

  test('a transport failure keeps the accepted value and reports the failure', async () => {
    const { form, writes } = hostForm(true)
    const state = trackPresentation(form)
    state.setPrompt(false)
    writes[0].fail()
    await settled()
    expect(state.settings.getSnapshot().prompt).toBe(true)
    expect(state.saveFailed.getSnapshot()).toBe(true)
  })

  test('a refused write keeps the accepted value and reports the failure', async () => {
    const { form, writes } = hostForm(true)
    const state = trackPresentation(form)
    state.setPrompt(false)
    writes[0].refuse()
    await settled()
    expect(state.settings.getSnapshot().prompt).toBe(true)
    expect(state.saveFailed.getSnapshot()).toBe(true)
  })

  test('a new choice clears the earlier failure, and an older failure never overrides a newer write', async () => {
    const { form, writes } = hostForm(true)
    const state = trackPresentation(form)
    state.setPrompt(false)
    writes[0].fail()
    await settled()
    expect(state.saveFailed.getSnapshot()).toBe(true)

    state.setPrompt(false)
    expect(state.saveFailed.getSnapshot()).toBe(false)
    state.setPrompt(true)
    writes[1].fail()
    await settled()
    expect(state.saveFailed.getSnapshot()).toBe(false)
    writes[2].accept()
    await settled()
    expect(state.settings.getSnapshot().prompt).toBe(true)
    expect(state.saveFailed.getSnapshot()).toBe(false)
  })

  test('a Host change made elsewhere is followed until disposed', () => {
    const { form, changeElsewhere } = hostForm(false)
    const state = trackPresentation(form)
    changeElsewhere(true)
    expect(state.settings.getSnapshot().prompt).toBe(true)
    state.dispose()
    changeElsewhere(false)
    expect(state.settings.getSnapshot().prompt).toBe(true)
  })
})
