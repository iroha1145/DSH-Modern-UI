import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  conversationFor,
  decisionFromResponse,
  installJevRouting,
  type JevSettings,
  PRESENTATIONS,
  PresentationRouter,
  type RoutedSession,
  routingHint,
} from '../../packages/modern-ui/src/jev-routing.ts'

const settings = (patch: Partial<JevSettings> = {}): JevSettings => ({
  enabled: true,
  credential: 'TYPESAFE_API_KEY',
  model: 'jev-latest',
  endpoint: 'http://127.0.0.1:9/v1/systemone',
  timeout: 200,
  ...patch,
})

const answer = (choice: string, extra: Record<string, unknown> = {}) => ({
  model: 'jev-1.13.0',
  answers: { presentation: { type: 'choice', choice, confidence: 0.8, probabilities: { [choice]: 0.8, text: 0.2 }, ...extra } },
})

type Entry = { type: string; data: unknown }
const user = (id: string, text: string, kind = 'user'): Entry => ({
  type: 'user/message',
  data: { id, role: 'user', source: { kind }, content: [{ type: 'text', text }] },
})
const assistant = (text: string): Entry => ({
  type: 'assistant/message',
  data: { message: { id: `a-${text}`, role: 'assistant', content: [{ type: 'text', text }] } },
})

function session(entries: Entry[], origin?: string): RoutedSession & { entries: Entry[] } {
  return {
    id: 's1',
    header: origin === undefined ? {} : { origin },
    entries,
    get surface() {
      return { nodes: entries.map((_, index) => index) }
    },
    eventAt: ((seq: number) => entries[seq]) as never,
  }
}

function jev(respond: (body: Record<string, unknown>, init: RequestInit) => Promise<Response> | Response) {
  const calls: { url: string; body: Record<string, unknown>; init: RequestInit }[] = []
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    calls.push({ url: String(url), body, init: init ?? {} })
    return respond(body, init ?? {})
  }) as unknown as typeof globalThis.fetch
  return { fetch, calls }
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

describe('decisionFromResponse', () => {
  test('accepts a choice among the presentations with a confidence and probabilities in range', () => {
    expect(decisionFromResponse(answer('flowchart'))).toEqual({ presentation: 'flowchart', confidence: 0.8 })
  })

  test('rejects unknown choices, other answer types and out-of-range numbers', () => {
    expect(decisionFromResponse(answer('map'))).toBeUndefined()
    expect(decisionFromResponse(answer('table', { type: 'score' }))).toBeUndefined()
    expect(decisionFromResponse(answer('table', { confidence: 1.5 }))).toBeUndefined()
    expect(decisionFromResponse(answer('table', { probabilities: { table: 0.9, map: 0.1 } }))).toBeUndefined()
    expect(decisionFromResponse(answer('table', { probabilities: { table: -1 } }))).toBeUndefined()
    expect(decisionFromResponse({})).toBeUndefined()
    expect(decisionFromResponse(null)).toBeUndefined()
  })
})

describe('routingHint', () => {
  test('names the presentation and the components, and lets the user win', () => {
    expect(routingHint({ presentation: 'flowchart', confidence: 0.9 })).toContain('flowchart — use one openui-lang block with Flow, FlowNode and FlowArrow')
    expect(routingHint({ presentation: 'text', confidence: 0.9 })).toContain(
      'answer in Markdown without an openui-lang block, unless the user asked for a visual',
    )
    expect(routingHint({ presentation: 'table', confidence: 0.9 })).toContain("the user's explicit wishes win")
  })

  test('covers every presentation offered to Jev', () => {
    for (const presentation of Object.keys(PRESENTATIONS)) expect(routingHint({ presentation, confidence: 1 } as never)).toMatch(/— \S/)
  })
})

describe('conversationFor', () => {
  test('keys the turn by the latest user message and sends the last four texts, each capped', () => {
    const long = 'x'.repeat(7000)
    const result = conversationFor(
      session([
        user('u1', 'first'),
        assistant('reply one'),
        user('u2', 'second'),
        user('ctx', 'runtime context', 'runtime-context'),
        assistant(long),
        user('u3', 'third'),
      ]),
    )
    expect(result?.turn).toBe('s1:u3')
    expect(result?.conversation.map(entry => entry.role)).toEqual(['assistant', 'user', 'assistant', 'user'])
    expect(result?.conversation[2].content).toHaveLength(6000)
    expect(result?.conversation.some(entry => entry.content === 'runtime context')).toBe(false)
  })

  test('has nothing to route before a user message', () => {
    expect(conversationFor(session([assistant('hello')]))).toBeUndefined()
  })

  test('treats a claimed message the session has not admitted yet as the latest, once', () => {
    const live = session([user('u1', 'first'), assistant('ok')])
    const claimed = user('u2', 'draw the request path').data as object
    expect(conversationFor(live, [claimed])).toEqual({
      turn: 's1:u2',
      conversation: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'draw the request path' },
      ],
    })
    live.entries.push(user('u2', 'draw the request path'))
    expect(conversationFor(live, [claimed])?.conversation.filter(entry => entry.content === 'draw the request path')).toHaveLength(1)
  })
})

describe('PresentationRouter', () => {
  test('without a key it neither calls Jev nor warns', async () => {
    const { fetch, calls } = jev(() => json(answer('table')))
    const warn = vi.fn()
    const router = new PresentationRouter(() => settings(), { fetch, resolveKey: async () => undefined, warn })
    expect(await router.decide(session([user('u1', 'compare these')]))).toBeUndefined()
    expect(calls).toHaveLength(0)
    expect(warn).not.toHaveBeenCalled()
  })

  test('asks once per user message with the documented request and reuses the decision within the turn', async () => {
    const { fetch, calls } = jev(() => json(answer('table')))
    const router = new PresentationRouter(() => settings(), { fetch, resolveKey: async () => 'test-key', warn: vi.fn() })
    const live = session([user('u1', 'compare redis and memcached')])
    expect(await router.decide(live)).toEqual({ presentation: 'table', confidence: 0.8 })
    expect(await router.decide(live)).toEqual({ presentation: 'table', confidence: 0.8 })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://127.0.0.1:9/v1/systemone')
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer test-key')
    expect(calls[0].body).toMatchObject({ model: 'jev-latest', state: { conversation: [{ role: 'user', content: 'compare redis and memcached' }] } })
    expect(Object.keys((calls[0].body.questions as { presentation: { criteria: object } }).presentation.criteria)).toEqual(Object.keys(PRESENTATIONS))
    live.entries.push(assistant('done'), user('u2', 'now draw the request path'))
    await router.decide(live)
    expect(calls).toHaveLength(2)
  })

  test('an error, an invalid answer or a timeout yields no decision, warns once per session, and never throws', async () => {
    const warn = vi.fn()
    const failing = new PresentationRouter(() => settings(), { fetch: jev(() => json({ error: 'nope' }, 500)).fetch, resolveKey: async () => 'k', warn })
    expect(await failing.decide(session([user('u1', 'a')]))).toBeUndefined()
    const invalid = new PresentationRouter(() => settings(), { fetch: jev(() => json(answer('map'))).fetch, resolveKey: async () => 'k', warn })
    expect(await invalid.decide(session([user('u1', 'b')]))).toBeUndefined()
    const hanging = jev((_body, init) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))))
    const slow = new PresentationRouter(() => settings({ timeout: 50 }), { fetch: hanging.fetch, resolveKey: async () => 'k', warn })
    const started = Date.now()
    expect(await slow.decide(session([user('u1', 'c')]))).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(1000)
    expect(warn).toHaveBeenCalledTimes(3)
    const repeated = session([user('u1', 'd')])
    await failing.decide(repeated)
    repeated.entries.push(user('u2', 'e'))
    await failing.decide(repeated)
    expect(warn).toHaveBeenCalledTimes(3)
  })

  test('subagent sessions, a disabled switch and a malformed credential name skip Jev', async () => {
    const { fetch, calls } = jev(() => json(answer('table')))
    const deps = { fetch, resolveKey: async () => 'k', warn: vi.fn() }
    expect(await new PresentationRouter(() => settings(), deps).decide(session([user('u1', 'a')], 'subagent'))).toBeUndefined()
    expect(await new PresentationRouter(() => settings({ enabled: false }), deps).decide(session([user('u1', 'a')]))).toBeUndefined()
    expect(await new PresentationRouter(() => settings({ credential: 'not a name' }), deps).decide(session([user('u1', 'a')]))).toBeUndefined()
    expect(calls).toHaveLength(0)
  })

  test('an aborted turn is asked again when it is retried', async () => {
    const { fetch, calls } = jev((_body, init) => (init.signal?.aborted ? Promise.reject(new Error('aborted')) : json(answer('steps'))))
    const router = new PresentationRouter(() => settings(), { fetch, resolveKey: async () => 'k', warn: vi.fn() })
    const live = session([user('u1', 'how do I set this up')])
    const controller = new AbortController()
    controller.abort()
    expect(await router.decide(live, controller.signal)).toBeUndefined()
    expect(await router.decide(live)).toEqual({ presentation: 'steps', confidence: 0.8 })
    expect(calls).toHaveLength(2)
  })
})

describe('installJevRouting', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  function host(key: string | undefined) {
    // biome-ignore lint/suspicious/noExplicitAny: a recording stand-in for the Host event bus
    const listeners = new Map<string, (...args: any[]) => any>()
    const scope = {
      credentials: { resolve: async () => (key === undefined ? undefined : { value: key, source: 'env' }) },
      logger: { warn: vi.fn() },
      // biome-ignore lint/suspicious/noExplicitAny: see above
      on: (event: string, fn: (...args: any[]) => any) => {
        listeners.set(event, fn)
      },
    }
    const ctx = { inject: (_deps: string[], callback: (scope: unknown) => void) => callback(scope) }
    return {
      ctx,
      scope,
      claim: (agent: object, message: unknown, turn: number) => listeners.get('agent/inbox/claimed')?.({ agent, message, turn }),
      assemble: async (agent: unknown) =>
        listeners.get('system-prompt/assemble')?.({}, { agent }, async () => ({ sections: [], contexts: [], tools: [], variables: {} })) as Promise<{
          contexts: { name: string; text: string }[]
        }>,
    }
  }

  test('adds one runtime-context hint while the presentation prompt is on, and nothing otherwise', async () => {
    globalThis.fetch = jev(() => json(answer('calculator'))).fetch
    let prompt = true
    const { ctx, assemble } = host('k')
    installJevRouting(
      ctx as never,
      () => settings(),
      () => prompt,
    )
    const agent = { session: session([user('u1', 'estimate monthly storage for 20k users')]) }
    const on = await assemble(agent)
    expect(on.contexts).toEqual([
      { name: 'modern-ui:presentation-route', text: expect.stringContaining('calculator — use one openui-lang block as a working tool'), interpolate: false },
    ])
    prompt = false
    expect((await assemble(agent)).contexts).toEqual([])
    expect((await assemble(undefined)).contexts).toEqual([])
  })

  test('routes on the message the inbox just claimed, before the Host admits it', async () => {
    const recorded = jev(() => json(answer('flowchart')))
    globalThis.fetch = recorded.fetch
    const { ctx, claim, assemble } = host('k')
    installJevRouting(
      ctx as never,
      () => settings(),
      () => true,
    )
    const agent = { session: session([user('u1', 'hello'), assistant('ok')]) }
    claim(agent, user('u2', 'draw the request path').data, 2)
    expect((await assemble(agent)).contexts[0].text).toContain('flowchart')
    const sent = recorded.calls[0].body.state as { conversation: { content: string }[] }
    expect(sent.conversation.at(-1)?.content).toBe('draw the request path')
    agent.session.entries.push(user('u2', 'draw the request path'))
    await assemble(agent)
    expect(recorded.calls).toHaveLength(1)
  })

  test('without a key the assembly is left exactly as the Host built it', async () => {
    const recorded = jev(() => json(answer('table')))
    globalThis.fetch = recorded.fetch
    const { ctx, scope, assemble } = host(undefined)
    installJevRouting(
      ctx as never,
      () => settings(),
      () => true,
    )
    expect((await assemble({ session: session([user('u1', 'compare')]) })).contexts).toEqual([])
    expect(recorded.calls).toHaveLength(0)
    expect(scope.logger.warn).not.toHaveBeenCalled()
  })
})
