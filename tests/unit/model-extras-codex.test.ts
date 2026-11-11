import { describe, expect, it, vi } from 'vitest'
import { createCodexSpeed, codexSpeedChoices } from '../../packages/modern-ui/src/model-extras-codex.ts'
const reply = (patch = {}) => ({ ok: true, value: { speedMode: 'standard', writable: true, fastModels: ['model'], ultrafastModels: ['model'], ...patch } })
const deferred = () => {
  let resolve!: (value: unknown) => void
  let reject!: (error: Error) => void
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
}
describe('Codex preference requests', () => {
  it('does not call unused preferences on reset or allow writes before a ready writable reply', async () => {
    const call = vi.fn().mockResolvedValue(reply({ writable: false }))
    const speed = createCodexSpeed(call)
    speed.reset()
    speed.reset()
    speed.reset()
    expect((await speed.choose('fast')).ok).toBe(false)
    expect(call).not.toHaveBeenCalled()
    speed.refresh()
    await settle()
    expect((await speed.choose('fast')).ok).toBe(false)
    expect(call).toHaveBeenCalledTimes(1)
  })
  it('rechecks permissions after a failed write without retaining write access', async () => {
    const reload = deferred()
    const call = vi.fn().mockResolvedValueOnce(reply()).mockRejectedValueOnce(new Error('denied')).mockReturnValueOnce(reload.promise)
    const speed = createCodexSpeed(call)
    speed.refresh()
    await settle()
    expect((await speed.choose('fast')).ok).toBe(false)
    expect(speed.store.getSnapshot()).toMatchObject({ writable: false, pending: undefined })
    expect((await speed.choose('fast')).ok).toBe(false)
    reload.resolve(reply({ writable: false, fastModels: [], ultrafastModels: [] }))
    await settle()
    expect(codexSpeedChoices(speed.store.getSnapshot(), 'model')).toEqual([])
  })
  it('invalidates a pending write on reset and rejects its late capabilities', async () => {
    const write = deferred(),
      reload = deferred()
    const call = vi.fn().mockResolvedValueOnce(reply()).mockReturnValueOnce(write.promise).mockReturnValueOnce(reload.promise)
    const speed = createCodexSpeed(call)
    speed.refresh()
    await settle()
    const result = speed.choose('fast')
    expect(speed.store.getSnapshot().pending).toBe('fast')
    speed.reset()
    expect(speed.store.getSnapshot().status).toBe('unknown')
    expect(speed.store.getSnapshot().pending).toBeUndefined()
    reload.resolve(reply({ writable: false, fastModels: [] }))
    await settle()
    write.resolve(reply({ speedMode: 'fast' }))
    expect((await result).ok).toBe(false)
    expect(speed.store.getSnapshot().writable).toBe(false)
    expect(codexSpeedChoices(speed.store.getSnapshot(), 'model')).toEqual(['standard', 'ultrafast'])
  })
  it('invalidates an initial read on reset and uses the new connection', async () => {
    const old = deferred(),
      fresh = deferred()
    const speed = createCodexSpeed(vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise))
    speed.refresh()
    speed.reset()
    fresh.resolve(reply({ writable: false }))
    await settle()
    old.resolve(reply())
    await settle()
    expect(speed.store.getSnapshot().writable).toBe(false)
  })
  it('retains a read-only ready snapshot after transport failure, then recovers', async () => {
    const speed = createCodexSpeed(vi.fn().mockResolvedValueOnce(reply()).mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(reply()))
    speed.refresh()
    await settle()
    speed.refresh()
    await settle()
    expect(speed.store.getSnapshot()).toMatchObject({ status: 'ready', writable: false })
    expect((await speed.choose('fast')).ok).toBe(false)
    speed.refresh()
    await settle()
    expect(speed.store.getSnapshot().writable).toBe(true)
  })
  it.each([
    { ok: false, error: { message: 'denied' } },
    { ok: true, value: { speedMode: 'fast' } },
  ])('clears capabilities after a rejected or incompatible reply', async bad => {
    const speed = createCodexSpeed(vi.fn().mockResolvedValueOnce(reply()).mockResolvedValueOnce(bad))
    speed.refresh()
    await settle()
    speed.refresh()
    await settle()
    expect(speed.store.getSnapshot().status).toBe('absent')
    expect(codexSpeedChoices(speed.store.getSnapshot(), 'model')).toEqual([])
  })
  it('accepts complete update status including revoked permissions and lists', async () => {
    const speed = createCodexSpeed(
      vi
        .fn()
        .mockResolvedValueOnce(reply())
        .mockResolvedValueOnce(reply({ speedMode: 'fast', writable: false, fastModels: [], ultrafastModels: [], liveSynced: false })),
    )
    speed.refresh()
    await settle()
    expect(await speed.choose('fast')).toEqual({ ok: true, restartRequired: true })
    expect(speed.store.getSnapshot()).toMatchObject({ mode: 'fast', writable: false, fastModels: [], ultrafastModels: [] })
  })
  it('does not allow overlapping writes or a stale read to overwrite a write', async () => {
    const read = deferred(),
      write = deferred(),
      call = vi.fn().mockResolvedValueOnce(reply()).mockReturnValueOnce(read.promise).mockReturnValueOnce(write.promise)
    const speed = createCodexSpeed(call)
    speed.refresh()
    await settle()
    speed.refresh()
    const saved = speed.choose('fast')
    expect((await speed.choose('ultrafast')).ok).toBe(false)
    speed.refresh()
    expect(call).toHaveBeenCalledTimes(3)
    write.resolve(reply({ speedMode: 'fast' }))
    await saved
    read.resolve(reply())
    await settle()
    expect(speed.store.getSnapshot().mode).toBe('fast')
  })
  it('recovers after a failed write and keeps late failures from changing reset state', async () => {
    const failed = deferred(),
      call = vi
        .fn()
        .mockResolvedValueOnce(reply())
        .mockReturnValueOnce(failed.promise)
        .mockResolvedValueOnce(reply({ writable: false }))
    const speed = createCodexSpeed(call)
    speed.refresh()
    await settle()
    const saving = speed.choose('fast')
    speed.reset()
    await settle()
    failed.reject(new Error('old transport'))
    expect((await saving).ok).toBe(false)
    expect(speed.store.getSnapshot().writable).toBe(false)
    expect(call).toHaveBeenCalledTimes(3)
  })
})
