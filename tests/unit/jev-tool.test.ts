import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  type AdvisedSession,
  adviceFor,
  decisionFromResponse,
  installJevTool,
  JEV_TOOL,
  type JevSettings,
  jevToolDefinition,
  PRESENTATIONS,
  PresentationAdvisor,
  SUMMARY_LIMIT,
} from '../../packages/modern-ui/src/jev-tool.ts'
import { PRESENTATION_PROMPT } from '../../packages/modern-ui/src/vendor/intelligent/presentation-prompt.ts'

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

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

function jev(respond: (body: Record<string, unknown>, init: RequestInit) => Promise<Response> | Response) {
  const calls: { url: string; body: Record<string, unknown>; init: RequestInit }[] = []
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    calls.push({ url: String(url), body, init: init ?? {} })
    return respond(body, init ?? {})
  }) as unknown as typeof globalThis.fetch
  return { fetch, calls }
}

type Event = { type: string; data: unknown }
const turnStart = (turn: number): Event => ({ type: 'turn/start', data: { turn } })
const turnEnd = (turn: number): Event => ({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
const user = (text: string, kind = 'user'): Event => ({
  type: 'user/message',
  data: { id: `u-${text}`, role: 'user', source: { kind }, content: text === '' ? [{ type: 'image', mediaType: 'image/png' }] : [{ type: 'text', text }] },
})
const assistant = (text: string): Event => ({
  type: 'assistant/message',
  data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] } },
})

const session = (id = 's1', origin?: string): AdvisedSession => ({ id, header: origin === undefined ? {} : { origin } })
const call = (target: AdvisedSession, signal = new AbortController().signal) => ({ agent: { session: target }, signal })
const summary = 'Two caches to compare on latency, memory use and persistence; both report comparable numbers.'

function advisor(options: {
  fetch: typeof fetch
  key?: string | undefined
  config?: () => JevSettings
  prompt?: () => boolean
  warn?: (message: string) => void
}) {
  const warn = options.warn ?? vi.fn()
  const resolveKey = vi.fn(async () => ('key' in options ? options.key : 'test-key'))
  const instance = new PresentationAdvisor(options.config ?? (() => settings()), options.prompt ?? (() => true), { fetch: options.fetch, resolveKey, warn })
  return { instance, warn, resolveKey }
}

/** A session with one open turn holding the given user messages. */
function openTurn(target: { observe: PresentationAdvisor['observe'] }, live: AdvisedSession, ...events: Event[]) {
  target.observe(live, turnStart(1))
  for (const event of events) target.observe(live, event)
}

// Phrases that would turn the advice into a rule rather than an option.
const RULE = /\b(must|do not|don't|never|always|required|should)\b/i
const CAPABILITY = "Jev saw the user's request for this turn and your content summary, not the full sources."

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

describe('advice wording', () => {
  test('"text" means no additional suggestion and leaves every component open', () => {
    const advice = adviceFor({ presentation: 'text', confidence: 0.97 })
    expect(advice).toEqual({ status: 'no_suggestion', presentation: 'text', confidence: 0.97, advice: expect.any(String) })
    expect(advice.advice).toBe(
      `No additional presentation suggestion. Choose from the material and the user's preferences; you may use or combine any components that fit. (${CAPABILITY})`,
    )
  })

  test('every visual choice is an ignorable, combinable partial candidate, and confidence stays out of the text', () => {
    const table = adviceFor({ presentation: 'table', confidence: 0.91 })
    expect(table.advice).toBe(
      `You could consider a table (Table) for the parts that compare items along shared dimensions or list exact records. You may ignore this, choose another form, or combine it with text and other components. (${CAPABILITY})`,
    )
    for (const presentation of Object.keys(PRESENTATIONS).filter(key => key !== 'text')) {
      const advice = adviceFor({ presentation, confidence: 0.91 } as never)
      expect(advice.status).toBe('suggestion')
      expect(advice.confidence).toBe(0.91)
      expect(advice.advice).toMatch(/^You could consider \S.* for (the )?parts /)
      expect(advice.advice).toContain('You may ignore this, choose another form, or combine it with text and other components.')
      expect(advice.advice).toContain(CAPABILITY)
      expect(advice.advice).not.toMatch(/0\.91|confiden/i)
      expect(advice.advice).not.toMatch(RULE)
    }
    expect(adviceFor({ presentation: 'text', confidence: 1 }).advice).not.toMatch(RULE)
  })

  test('the tool description says Jev is optional, never a prerequisite, and what it can see', () => {
    const definition = jevToolDefinition(advisor({ fetch: jev(() => json(answer('text'))).fetch }).instance)
    expect(definition.name).toBe(JEV_TOOL)
    expect(definition.description).toContain('Calling it is not a prerequisite for using OpenUI components or for answering')
    expect(definition.description).toContain('answering without consulting Jev is a normal outcome')
    expect(definition.description).toContain('it does not see sources, files or tool results')
    expect(definition.description).not.toMatch(/\bmust\b|before answering/i)
    expect(definition.parameters).toEqual({
      type: 'object',
      properties: { content_summary: { type: 'string', description: expect.stringContaining(`at most ${SUMMARY_LIMIT} characters`) } },
      required: ['content_summary'],
      additionalProperties: false,
    })
    // Neither the presentation prompt nor anything else asks the model to call Jev.
    expect(PRESENTATION_PROMPT).not.toMatch(/jev|presentation_advice/i)
  })

  test('the card keeps status, choice and confidence; the model reads only the advice text', () => {
    const definition = jevToolDefinition(advisor({ fetch: jev(() => json(answer('text'))).fetch }).instance)
    const value = adviceFor({ presentation: 'flowchart', confidence: 0.7 })
    expect(definition.output.render({}, value as never)).toEqual([{ type: 'text', text: value.advice }])
    expect(definition.output.presentationMeta?.({}, value as never)).toEqual({ status: 'suggestion', presentation: 'flowchart', confidence: 0.7 })
    expect(definition.output.presentationMeta?.({}, adviceFor(undefined) as never)).toEqual({ status: 'unavailable' })
  })
})

describe('PresentationAdvisor', () => {
  test('sends the bound user request and the summary with the documented question, once', async () => {
    const recorded = jev(() => json(answer('table')))
    const { instance } = advisor({ fetch: recorded.fetch })
    const live = session()
    openTurn(instance, live, user('compare redis and memcached'))
    const advice = await instance.advise({ content_summary: summary }, call(live))
    expect(advice).toMatchObject({ status: 'suggestion', presentation: 'table', confidence: 0.8 })
    expect(recorded.calls).toHaveLength(1)
    const [sent] = recorded.calls
    expect(sent.url).toBe('http://127.0.0.1:9/v1/systemone')
    expect(sent.init.method).toBe('POST')
    expect((sent.init.headers as Record<string, string>).authorization).toBe('Bearer test-key')
    expect(sent.body).toMatchObject({
      model: 'jev-latest',
      state: {
        conversation: [
          { role: 'user', content: 'compare redis and memcached' },
          { role: 'assistant', content: `Structure of the planned answer: ${summary}` },
        ],
      },
    })
    const question = (sent.body.questions as { presentation: { type: string; criteria: object; instructions: string } }).presentation
    expect(question.type).toBe('choice')
    expect(Object.keys(question.criteria)).toEqual(Object.keys(PRESENTATIONS))
    expect(question.instructions).toContain("the assistant's own description of the structure of its planned answer")
    expect(question.instructions).toContain('That description is not the answer itself.')
    expect(question.instructions).toContain('or several_visuals when they want more than one; never text')
  })

  test('binds to the turn being processed: not an earlier turn, not another session, not non-user context', async () => {
    const recorded = jev(() => json(answer('flowchart')))
    const { instance } = advisor({ fetch: recorded.fetch })
    const first = session('s1')
    const second = session('s2')
    instance.observe(first, turnStart(1))
    instance.observe(first, user('what is a CDN'))
    instance.observe(first, assistant('A CDN is…'))
    instance.observe(first, turnEnd(1))
    instance.observe(first, turnStart(2))
    instance.observe(second, turnStart(1))
    instance.observe(second, user('estimate the monthly bill'))
    instance.observe(first, user('draw the request path'))
    instance.observe(first, user('skill text that the user did not write', 'skill'))
    instance.observe(first, user('actually only the cache-miss path'))
    instance.observe(first, user(''))
    await instance.advise({ content_summary: summary }, call(first))
    const conversation = (recorded.calls[0].body.state as { conversation: { role: string; content: string }[] }).conversation
    // A steer admitted in the same turn is still part of what the turn is processing.
    expect(conversation).toEqual([
      { role: 'user', content: 'draw the request path' },
      { role: 'user', content: 'actually only the cache-miss path' },
      { role: 'user', content: '(attachments without text)' },
      { role: 'assistant', content: `Structure of the planned answer: ${summary}` },
    ])
  })

  test('outside an observed turn nothing is sent, so a stale or foreign message can never be attached', async () => {
    const recorded = jev(() => json(answer('table')))
    const { instance } = advisor({ fetch: recorded.fetch })
    const live = session()
    // Started before the plugin saw the turn open.
    instance.observe(live, user('compare these'))
    expect(await instance.advise({ content_summary: summary }, call(live))).toMatchObject({
      status: 'unavailable',
      advice: expect.stringContaining('the user request for this turn could not be identified'),
    })
    openTurn(instance, live, user('compare these'))
    instance.observe(live, turnEnd(1))
    expect((await instance.advise({ content_summary: summary }, call(live))).status).toBe('unavailable')
    expect(recorded.calls).toHaveLength(0)
  })

  test(`enforces the ${SUMMARY_LIMIT}-character budget in code points, without using up the turn`, async () => {
    const recorded = jev(() => json(answer('table')))
    const { instance } = advisor({ fetch: recorded.fetch })
    const live = session()
    openTurn(instance, live, user('比较这三篇论文'))
    const tooLong = await instance.advise({ content_summary: '字'.repeat(SUMMARY_LIMIT + 1) }, call(live))
    expect(tooLong.status).toBe('not_sent')
    expect(tooLong.advice).toContain(`content_summary has ${SUMMARY_LIMIT + 1} characters and the limit is ${SUMMARY_LIMIT}`)
    expect(tooLong.advice).toContain("did not use up this turn's consultation")
    expect((await instance.advise({ content_summary: '   ' }, call(live))).status).toBe('not_sent')
    expect((await instance.advise({ content_summary: 42 }, call(live))).status).toBe('not_sent')
    expect((await instance.advise({}, call(live))).status).toBe('not_sent')
    expect(recorded.calls).toHaveLength(0)
    // Exactly at the limit, counting a surrogate pair as one character, is sent.
    const atLimit = `${'😀'.repeat(SUMMARY_LIMIT - 1)}字`
    expect((await instance.advise({ content_summary: atLimit }, call(live))).status).toBe('suggestion')
    expect(recorded.calls).toHaveLength(1)
  })

  test('one request per turn: the same summary repeats the reply, a different one gets no new judgement', async () => {
    const recorded = jev(() => json(answer('table')))
    const { instance } = advisor({ fetch: recorded.fetch })
    const live = session()
    openTurn(instance, live, user('compare redis and memcached'))
    const first = await instance.advise({ content_summary: summary }, call(live))
    const repeated = await instance.advise({ content_summary: `  ${summary.replaceAll(' ', '\n  ')} ` }, call(live))
    expect(recorded.calls).toHaveLength(1)
    expect(repeated).toMatchObject({ status: 'repeated', presentation: 'table' })
    expect(repeated.advice).toBe(`Same summary as the earlier call in this turn, so this repeats that reply. ${first.advice}`)
    const different = await instance.advise({ content_summary: 'Four options, each with a short pro and con list.' }, call(live))
    expect(recorded.calls).toHaveLength(1)
    expect(different).toEqual({
      status: 'already_consulted',
      advice: expect.stringContaining('Jev was already asked once in this turn, for a different content summary'),
    })
    expect(different.advice).toContain('there is no new suggestion for this summary, and the earlier reply applies only to the earlier summary')
    expect(different.advice).not.toMatch(/table/i)
    // The next turn may ask again.
    instance.observe(live, turnEnd(1))
    openTurn(instance, live, user('now the cost side'))
    await instance.advise({ content_summary: 'Four options, each with a short pro and con list.' }, call(live))
    expect(recorded.calls).toHaveLength(2)
  })

  test("a failed request still counts as the turn's request and degrades to an ordinary result", async () => {
    const warn = vi.fn()
    const recorded = jev(() => json({ error: 'nope' }, 500))
    const { instance } = advisor({ fetch: recorded.fetch, warn })
    const live = session()
    openTurn(instance, live, user('compare these'))
    const failed = await instance.advise({ content_summary: summary }, call(live))
    expect(failed).toEqual({
      status: 'unavailable',
      advice:
        "No presentation suggestion is available: Jev could not be reached or gave no valid answer. Choose the presentation from the material and the user's request.",
    })
    expect((await instance.advise({ content_summary: summary }, call(live))).status).toBe('unavailable')
    expect((await instance.advise({ content_summary: 'Something else entirely.' }, call(live))).status).toBe('already_consulted')
    expect(recorded.calls).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('(HTTP 500)')
  })

  test('an invalid answer or a timeout yields no suggestion quickly and never throws', async () => {
    const warn = vi.fn()
    const invalid = advisor({ fetch: jev(() => json(answer('map'))).fetch, warn }).instance
    const a = session('a')
    openTurn(invalid, a, user('x'))
    expect((await invalid.advise({ content_summary: summary }, call(a))).status).toBe('unavailable')
    const hanging = jev((_body, init) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))))
    const slow = advisor({ fetch: hanging.fetch, config: () => settings({ timeout: 50 }), warn }).instance
    const b = session('b')
    openTurn(slow, b, user('y'))
    const started = Date.now()
    expect((await slow.advise({ content_summary: summary }, call(b))).status).toBe('unavailable')
    expect(Date.now() - started).toBeLessThan(1000)
    expect(warn.mock.calls.map(([message]) => message)).toEqual([expect.stringContaining('(invalid decision)'), expect.stringContaining('(timed out)')])
  })

  test('passes the execution signal to fetch, so a cancelled turn stops the request without a warning', async () => {
    const warn = vi.fn()
    const hanging = jev((_body, init) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))))
    const { instance } = advisor({ fetch: hanging.fetch, config: () => settings({ timeout: 60_000 }), warn })
    const live = session()
    openTurn(instance, live, user('compare these'))
    const controller = new AbortController()
    const pending = instance.advise({ content_summary: summary }, call(live, controller.signal))
    await vi.waitFor(() => expect(hanging.calls).toHaveLength(1))
    expect(hanging.calls[0].init.signal?.aborted).toBe(false)
    controller.abort(new Error('user cancelled'))
    expect(hanging.calls[0].init.signal?.aborted).toBe(true)
    expect((await pending).status).toBe('unavailable')
    expect(warn).not.toHaveBeenCalled()
  })

  test('without a key, switched off, with the prompt off or in a subagent it neither calls Jev nor warns', async () => {
    const recorded = jev(() => json(answer('table')))
    const warn = vi.fn()
    const cases = [
      { options: { key: undefined }, reason: 'no TypeSafe key is configured' },
      { options: { config: () => settings({ enabled: false }) }, reason: 'Jev is switched off' },
      { options: { prompt: () => false }, reason: 'Jev is switched off' },
      { options: { config: () => settings({ credential: 'not a name' }) }, reason: 'Jev is switched off' },
    ]
    for (const { options, reason } of cases) {
      const { instance } = advisor({ fetch: recorded.fetch, warn, ...options })
      const live = session()
      openTurn(instance, live, user('compare these'))
      const advice = await instance.advise({ content_summary: summary }, call(live))
      expect(advice).toEqual({
        status: 'unavailable',
        advice: `No presentation suggestion is available: ${reason}. Choose the presentation from the material and the user's request.`,
      })
    }
    const { instance } = advisor({ fetch: recorded.fetch, warn })
    const child = session('child', 'subagent')
    openTurn(instance, child, user('compare these'))
    expect((await instance.advise({ content_summary: summary }, call(child))).advice).toContain('Jev is offered to the main session only')
    expect((await instance.advise({ content_summary: summary }, { signal: new AbortController().signal })).status).toBe('unavailable')
    expect(recorded.calls).toHaveLength(0)
    expect(warn).not.toHaveBeenCalled()
  })

  test('a key that cannot be a header value is refused before any request, and no log carries the key', async () => {
    const warn = vi.fn()
    const recorded = jev(() => json(answer('table')))
    const broken = advisor({ fetch: recorded.fetch, key: 'sk-synthetic\nsecond-line', warn }).instance
    const a = session('a')
    openTurn(broken, a, user('x'))
    expect((await broken.advise({ content_summary: summary }, call(a))).status).toBe('unavailable')
    expect(recorded.calls).toHaveLength(0)
    const leaky = vi.fn(async () => {
      throw new TypeError('Headers.append: "Bearer sk-leaky-key" is an invalid header value.')
    }) as unknown as typeof globalThis.fetch
    const throwing = advisor({ fetch: leaky, key: 'sk-leaky-key', warn }).instance
    const b = session('b')
    openTurn(throwing, b, user('y'))
    expect((await throwing.advise({ content_summary: summary }, call(b))).status).toBe('unavailable')
    for (const [message] of warn.mock.calls) expect(message).not.toMatch(/sk-synthetic|second-line|sk-leaky-key|Bearer/)
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining('the key contains characters a request header cannot carry'),
      expect.stringContaining('(request failed)'),
    ])
  })

  test('surrounding whitespace in a key, as an .env line leaves it, is trimmed', async () => {
    const recorded = jev(() => json(answer('table')))
    const { instance } = advisor({ fetch: recorded.fetch, key: '  sk-test \n' })
    const live = session()
    openTurn(instance, live, user('compare these'))
    await instance.advise({ content_summary: summary }, call(live))
    expect((recorded.calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer sk-test')
  })
})

describe('installJevTool', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  const flush = () => new Promise(resolve => setTimeout(resolve, 0))

  type FakeAgent = ReturnType<typeof fakeAgent>
  function fakeAgent(id: string, origin?: string) {
    const state = { live: undefined as ToolDefinition | undefined, registrations: 0, disposals: 0 }
    const agent = {
      id,
      session: { id, header: origin === undefined ? {} : { origin } },
      state,
      ctx: {
        inject: (deps: string[], callback: (scope: unknown) => void) => {
          expect(deps).toEqual(['tools'])
          callback({
            tools: {
              register: (definition: ToolDefinition) => {
                state.live = definition
                state.registrations++
              },
            },
          })
          return {
            dispose: async () => {
              state.live = undefined
              state.disposals++
            },
            then: (resolve: (value: unknown) => void) => resolve(undefined),
          }
        },
      },
    }
    return agent
  }

  function host(initialKey: string | undefined) {
    const state = { key: initialKey, enabled: true, prompt: true }
    // biome-ignore lint/suspicious/noExplicitAny: a recording stand-in for the Host event bus
    type Listener = (...args: any[]) => any
    const top = new Map<string, Listener>()
    const listeners = new Map<string, Listener>()
    const disposers: (() => Promise<void>)[] = []
    const agents: FakeAgent[] = []
    const roots = new Set<FakeAgent>()
    const scope = {
      credentials: { resolve: vi.fn(async () => (state.key === undefined ? undefined : { value: state.key, source: 'file' })) },
      agents: { list: () => [...agents], roots: () => agents.filter(agent => roots.has(agent)) },
      logger: { warn: vi.fn() },
      on: (event: string, fn: Listener) => {
        listeners.set(event, fn)
      },
      effect: (execute: () => () => Promise<void>) => {
        disposers.push(execute())
      },
    }
    const ctx = {
      on: (event: string, fn: Listener) => {
        top.set(event, fn)
      },
      inject: (deps: string[], callback: (scope: unknown) => void) => {
        expect(deps).toEqual(['credentials', 'agents'])
        callback(scope)
      },
    }
    const add = (agent: FakeAgent, root: boolean) => {
      agents.push(agent)
      if (root) roots.add(agent)
      return agent
    }
    const install = async () => {
      installJevTool(
        ctx as never,
        () => settings({ enabled: state.enabled }),
        () => state.prompt,
      )
      await flush()
    }
    return {
      state,
      scope,
      top,
      install,
      main: (id = 'main') => add(fakeAgent(id), true),
      subagent: (id = 'sub') => add(fakeAgent(id, 'subagent'), false),
      // Owned by another agent without the subagent origin, such as a teammate.
      child: (id = 'child') => add(fakeAgent(id), false),
      created: async (agent: FakeAgent) => {
        await listeners.get('agent/created')?.({ agent, source: 'startup' })
        await flush()
      },
      disposed: (agent: FakeAgent) => listeners.get('agent/disposed')?.({ agent }),
      keyUpdated: async (ref = 'TYPESAFE_API_KEY') => {
        listeners.get('credentials/reference-updated')?.(ref)
        await flush()
      },
      volatile: async (section = 'jev') => {
        top.get('loader/volatile-update')?.([[section]])
        await flush()
      },
      event: (agent: FakeAgent, event: Event) => listeners.get('session/event')?.(agent.session, event),
      dispose: () => Promise.all(disposers.map(dispose => dispose())),
    }
  }

  test('without a key nothing is registered; a key saved in Settings shows the tool to main agents only', async () => {
    const env = host(undefined)
    const main = env.main()
    const sub = env.subagent()
    const child = env.child()
    await env.install()
    expect([main, sub, child].map(agent => agent.state.live)).toEqual([undefined, undefined, undefined])
    env.state.key = 'test-key'
    const reads = env.scope.credentials.resolve.mock.calls.length
    await env.keyUpdated('SOME_OTHER_KEY')
    expect(env.scope.credentials.resolve.mock.calls.length).toBe(reads)
    expect(main.state.live).toBeUndefined()
    await env.keyUpdated()
    expect(main.state.live?.name).toBe(JEV_TOOL)
    expect(sub.state.live).toBeUndefined()
    expect(child.state.live).toBeUndefined()
    // Removing the key takes the tool away again.
    env.state.key = undefined
    await env.keyUpdated()
    expect(main.state.live).toBeUndefined()
    expect(main.state.disposals).toBe(1)
  })

  test('switching Jev or the presentation prompt off removes the tool; switching back restores it', async () => {
    const env = host('test-key')
    const main = env.main()
    await env.install()
    expect(main.state.live?.name).toBe(JEV_TOOL)
    // The listener sits on the plugin's own context, where the Loader announces volatile changes.
    expect(env.top.has('loader/volatile-update')).toBe(true)
    const seen = main.state.live as ToolDefinition
    env.state.enabled = false
    await env.volatile()
    expect(main.state.live).toBeUndefined()
    // A model that saw the tool before the switch still gets an ordinary "no suggestion" result.
    const fetchSpy = jev(() => json(answer('table')))
    globalThis.fetch = fetchSpy.fetch
    env.event(main, turnStart(1))
    env.event(main, user('compare these'))
    const late = (await seen.execute({ content_summary: summary }, { agent: main, signal: new AbortController().signal } as never)) as {
      status: string
      advice: string
    }
    expect(late.status).toBe('unavailable')
    expect(late.advice).toContain('Jev is switched off')
    expect(fetchSpy.calls).toHaveLength(0)
    env.state.enabled = true
    await env.volatile()
    expect(main.state.live?.name).toBe(JEV_TOOL)
    env.state.prompt = false
    // Other volatile sections, such as collapsed views, leave the registrations and the key alone.
    const reads = env.scope.credentials.resolve.mock.calls.length
    await env.volatile('collapsedViews')
    expect(main.state.live?.name).toBe(JEV_TOOL)
    expect(env.scope.credentials.resolve.mock.calls.length).toBe(reads)
    await env.volatile('presentation')
    expect(main.state.live).toBeUndefined()
    expect(main.state.registrations).toBe(2)
  })

  test('a new main session has the tool before its first request; a new subagent never does', async () => {
    const env = host('test-key')
    await env.install()
    const main = env.main('later')
    await env.created(main)
    expect(main.state.live?.name).toBe(JEV_TOOL)
    const sub = env.subagent('later-sub')
    const reads = env.scope.credentials.resolve.mock.calls.length
    await env.created(sub)
    expect(sub.state.live).toBeUndefined()
    // Only a new main session re-reads the key.
    expect(env.scope.credentials.resolve.mock.calls.length).toBe(reads)
  })

  test('the registered tool answers from the bound turn through the Host fetch', async () => {
    const recorded = jev(() => json(answer('steps')))
    globalThis.fetch = recorded.fetch
    const env = host('test-key')
    const main = env.main()
    await env.install()
    env.event(main, turnStart(3))
    env.event(main, user('how do I migrate the database'))
    const definition = main.state.live as ToolDefinition
    const result = (await definition.execute({ content_summary: 'Five ordered steps with one rollback branch.' }, {
      agent: main,
      signal: new AbortController().signal,
    } as never)) as { status: string; presentation: string }
    expect(result).toMatchObject({ status: 'suggestion', presentation: 'steps' })
    expect((recorded.calls[0].body.state as { conversation: unknown[] }).conversation).toEqual([
      { role: 'user', content: 'how do I migrate the database' },
      { role: 'assistant', content: 'Structure of the planned answer: Five ordered steps with one rollback branch.' },
    ])
    expect((recorded.calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer test-key')
  })

  test('agent disposal forgets its registration, and unloading the plugin removes every registration', async () => {
    const env = host('test-key')
    const first = env.main('first')
    const second = env.main('second')
    await env.install()
    env.disposed(first)
    expect(first.state.disposals).toBe(1)
    await env.dispose()
    expect(second.state.live).toBeUndefined()
    expect(second.state.disposals).toBe(1)
    // A switch change after unloading does nothing.
    await env.volatile()
    expect(second.state.registrations).toBe(1)
  })
})
