import { describe, expect, it } from 'vitest'
import { attachmentReadProtocol, hostReleaseVersion, readImageAttachment } from '../../packages/modern-ui/src/host-contract.ts'

// Session.readAttachment keeps its name and arity across Host releases but changed its argument:
// 0.2.1 sends the attachment id, every 0.2.2 prerelease (alpha.2 onward) sends the full reference.

describe('attachment read protocol', () => {
  it.each([
    ['0.2.1-rc.2', 'attachment-id'],
    ['0.2.1-rc.3', 'attachment-id'],
    ['0.2.1-rc.4', 'attachment-id'],
    ['0.2.1-rc.5', 'attachment-id'],
    ['0.2.1', 'attachment-id'],
    ['0.2.2-alpha.2', 'attachment-ref'],
    ['0.2.2-alpha.3', 'attachment-ref'],
    ['0.2.2-rc.1', 'attachment-ref'],
    ['0.2.2-rc.2', 'attachment-ref'],
    ['0.2.2', 'attachment-ref'],
    ['0.2.10', 'attachment-ref'],
    ['0.3.0-alpha.1', 'attachment-ref'],
    ['1.0.0', 'attachment-ref'],
  ])('%s reads by %s', (version, protocol) => {
    expect(attachmentReadProtocol(version)).toBe(protocol)
  })

  it.each([undefined, '', 'dev', 'v0.2.2', '0.2'])('has no protocol for %j', version => {
    expect(attachmentReadProtocol(version)).toBeUndefined()
  })
})

describe('host release version', () => {
  it('reads the release the boot graph published', () => {
    const ctx = { get: (name: string) => (name === 'modules' ? { manifest: { release: { version: '0.2.2-rc.1', commit: 'abc' } } } : undefined) }
    expect(hostReleaseVersion(ctx as never)).toBe('0.2.2-rc.1')
  })

  it('is undefined without a published release', () => {
    expect(hostReleaseVersion({ get: () => ({ manifest: {} }) } as never)).toBeUndefined()
    expect(hostReleaseVersion({ get: () => undefined } as never)).toBeUndefined()
  })
})

describe('readImageAttachment', () => {
  const attachment = { attachmentId: 'att-1', mediaType: 'image/png', sha256: 'f'.repeat(64), size: 3 } as never

  function session() {
    const calls: unknown[] = []
    const value = {
      readAttachment(this: unknown, argument: unknown) {
        calls.push({ argument, bound: this === value })
        return Promise.resolve({ ok: true, value: { attachment, data: new Uint8Array([1, 2, 3]) } })
      },
    }
    return { value, calls }
  }

  it('passes the id to a 0.2.1 Session', async () => {
    const { value, calls } = session()
    await readImageAttachment(value as never, 'attachment-id', attachment)
    expect(calls).toEqual([{ argument: 'att-1', bound: true }])
  })

  it('passes the complete reference to a 0.2.2 Session', async () => {
    const { value, calls } = session()
    await readImageAttachment(value as never, 'attachment-ref', attachment)
    expect(calls).toEqual([{ argument: attachment, bound: true }])
  })
})
