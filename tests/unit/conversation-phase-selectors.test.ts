import { expect, test } from 'vitest'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { conversationPhase } from '../../packages/modern-ui/src/vendor/conversation/client/contract/snapshot.ts'
import { blankConversation, mainPanelPhase } from '../../packages/modern-ui/src/vendor/conversation/client/skeleton/session-phase.ts'
import { bindHostContract } from '../../packages/modern-ui/src/host-contract.ts'

const empty = {
  sessionId: 'session',
  pendingSubmissions: [],
  running: false,
  subagent: null,
  removed: false,
  openState: 'cold',
  openError: null,
  hasMore: false,
  loadingOlder: false,
  promptError: null,
  blank: true,
  lastAgentError: null,
  promptAttempted: false,
  awaitingFirstTurn: false,
} as SessionSnapshot

test('narrow selectors preserve audited lifecycle derivation for roots and continuable children', () => {
  for (const blank of [true, false])
    for (const running of [true, false])
      for (const promptAttempted of [true, false])
        for (const awaitingFirstTurn of [true, false])
          for (const openState of ['cold', 'loading', 'open', 'error'] as const)
            for (const summaryBlank of [undefined, true, false])
              for (const active of [true, false])
                for (const parentAvailable of ['root', undefined, true, false] as const) {
                  const subagent =
                    parentAvailable === 'root'
                      ? null
                      : {
                          address: { mode: 'continuable', parentSessionId: 'parent', childSessionId: 'session' },
                          ...(parentAvailable === undefined ? {} : { parentAvailable }),
                        }
                  const session = { ...empty, blank, running, promptAttempted, awaitingFirstTurn, openState, subagent } as SessionSnapshot
                  const conversation = { activeTargets: new Set(active ? ['chat'] : []), views: { get: () => undefined, grouped: () => undefined } }
                  const shellPhase = conversationPhase(session, conversation)
                  const oldSettling =
                    (shellPhase === 'blank' && openState === 'loading' && summaryBlank !== true) || (subagent !== null && parentAvailable === undefined)
                  const oldHero = shellPhase === 'blank' && (openState === 'open' || summaryBlank === true)
                  expect(mainPanelPhase('session', session, active, summaryBlank)).toBe(oldSettling ? 'settling' : oldHero ? 'hero' : 'active')
                  expect(blankConversation(session, active)).toBe(blank && shellPhase === 'blank')
                }
  expect(mainPanelPhase(undefined, undefined, undefined, undefined)).toBe('hero')
})

test('a continuable child never waits for its parent on a Host that no longer reports one', () => {
  const child = {
    ...empty,
    blank: false,
    openState: 'open',
    subagent: { address: { mode: 'continuable', parentSessionId: 'parent', childSessionId: 'session' } },
  } as SessionSnapshot
  // Up to 0.2.2-rc.1 a missing value means the parent is still being resolved.
  expect(mainPanelPhase('session', child, true, false)).toBe('settling')
  bindHostContract({ get: (name: string) => (name === 'modules' ? { manifest: { release: { version: '0.2.2-rc.2' } } } : undefined) } as never)
  try {
    expect(mainPanelPhase('session', child, true, false)).toBe('active')
  } finally {
    bindHostContract(undefined)
  }
})
