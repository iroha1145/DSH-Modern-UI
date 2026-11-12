import { build } from './client-build.mjs'
import { JSDOM } from 'jsdom'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'

const root = path.resolve(import.meta.dirname, '../../..')

export async function realSession() {
  // Expose the published class through its loader, without replacing its state or stream implementation.
  const official = (await readFile(path.join(root, 'node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js'), 'utf8')).replace(
    'exports.MutableSessionEventSource =',
    'exports.TestSession = Session; exports.MutableSessionEventSource =',
  )
  let factory
  vm.runInNewContext(official, {
    window: {
      __ModuleLoader__: {
        load: value => {
          factory = value.factory
        },
      },
    },
    queueMicrotask,
    setTimeout,
    clearTimeout,
    console,
    crypto: globalThis.crypto,
  })
  const exports = factory(name =>
    name.includes('cordis')
      ? { Context: { filter: Symbol() } }
      : name.includes('gateway')
        ? { RemoteJournalStream: class {} }
        : {
            notifySubscribers: listeners => {
              for (const listener of listeners) listener()
            },
          },
  )
  return new exports.TestSession('session', {})
}

export async function harness({ loadSource } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'conversation-subscriptions-'))
  const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', { pretendToBeVisual: true })
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'ResizeObserver', 'IS_REACT_ACT_ENVIRONMENT']
  const saved = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const close = async () => {
    dom.window.close()
    for (const [key, descriptor] of Object.entries(saved))
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    await rm(directory, { recursive: true, force: true })
  }
  for (const key of keys.slice(0, 5)) Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true })
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  try {
    const outfile = path.join(directory, 'harness.mjs')
    await build({
      stdin: {
        resolveDir: root,
        loader: 'tsx',
        contents: `
      import React,{act,useSyncExternalStore,Profiler} from 'react'; import {createRoot} from 'react-dom/client';
      export {React,act,createRoot,Profiler};
      export {assistantDefinition} from './packages/modern-ui/src/vendor/chat/client/conversation-nodes/assistant.ts';
      export {turnProcessDefinition} from './packages/modern-ui/src/vendor/chat/client/conversation-nodes/turn-process.ts';
      export {renderCounts} from "test-render-counts";
      export {ConversationContent} from './packages/modern-ui/src/vendor/conversation/client/skeleton/ConversationContent.tsx';
      export {DefaultConversationViews} from './packages/modern-ui/src/vendor/conversation/client/skeleton/DefaultConversationViews.tsx';
      export {ConversationSessionHeader} from './packages/modern-ui/src/vendor/conversation/client/skeleton/ConversationSession.tsx';
      export {ConversationMainPanel} from './packages/modern-ui/src/vendor/conversation/client/skeleton/ConversationMainPanel.tsx';
      export {ConversationHeader} from './packages/modern-ui/src/vendor/conversation/client/skeleton/ConversationHeader.tsx';
      export function bind(source){ return selector => useSyncExternalStore(source.subscribe.bind(source),()=>selector(source.getSnapshot())) }
    `,
      },
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"development"' },
      logLevel: 'silent',
      plugins: [
        {
          name: 'isolate-conversation-boundaries',
          setup(builder) {
            builder.onResolve({ filter: /^test-render-counts$/ }, () => ({ path: 'counts', namespace: 'counts' }))
            builder.onLoad({ filter: /.*/, namespace: 'counts' }, () => ({ contents: 'export const renderCounts = {}', loader: 'js' }))
            builder.onLoad({ filter: /skeleton[\\/]\w+\.tsx$/ }, async args => {
              let contents = loadSource ? await loadSource(args.path) : await readFile(args.path, 'utf8')
              contents = 'import {renderCounts} from "test-render-counts";\n' + contents
              contents = contents.replace(
                /function (ConversationContent|ConversationComposer|ConversationMainPanel)\(props: [^)]*\) \{/g,
                (match, name) => match + '\nrenderCounts.' + name + ' = (renderCounts.' + name + ' ?? 0) + 1;',
              )
              contents = contents.replace(
                '}: ConversationSessionSlotProps) {',
                '}: ConversationSessionSlotProps) {\nrenderCounts.DefaultConversationViews = (renderCounts.DefaultConversationViews ?? 0) + 1;',
              )
              contents = contents.replace(
                '}: ConversationHeaderProps) {',
                '}: ConversationHeaderProps) {\nrenderCounts.ConversationHeader = (renderCounts.ConversationHeader ?? 0) + 1;',
              )
              return { contents, loader: 'tsx', resolveDir: path.dirname(args.path) }
            })
            builder.onResolve({ filter: /^@iroha1145\/dsh-modern-ui\/primitives$/ }, () => ({ path: 'primitives', namespace: 'harness' }))
            builder.onResolve({ filter: /EmptyHero\.tsx$/ }, () => ({ path: 'hero', namespace: 'harness' }))
            builder.onResolve({ filter: /conversation-layout\.tsx$/ }, () => ({ path: 'layout', namespace: 'harness' }))
            builder.onLoad({ filter: /.*/, namespace: 'harness' }, args => ({
              contents:
                args.path === 'primitives'
                  ? "import React from 'react';export const Button=({children,size,...p})=><button {...p}>{children}</button>;export const Menu=({anchor,open,children})=><>{anchor}{open&&<div role='menu'>{children}</div>}</>;export const Tooltip=({children})=>children;export const IconEllipsisOutlineRegular=()=>null;"
                  : args.path === 'hero'
                    ? 'export const HeroShell=()=>null;export const WorkspaceChip=()=>null;export const workspaceLabel=x=>x;'
                    : 'export const ConversationWidthControls=()=>null;',
              loader: 'tsx',
              resolveDir: root,
            }))
            builder.onLoad({ filter: /\.css$/ }, () => ({ contents: 'export default new Proxy({}, {get:(_,key)=>key})', loader: 'js' }))
          },
        },
      ],
    })
    return { ...(await import(pathToFileURL(outfile).href)), document: dom.window.document, window: dom.window, outfile, close }
  } catch (error) {
    await close()
    throw error
  }
}

export function source(value) {
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe: fn => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    set(next) {
      value = next
      for (const fn of listeners) fn()
    },
  }
}
export const stable = value => selector => selector(value)
export const t = key => key

// Run real Chat business projections over the Session Controller event window.
// Location/context wiring is reduced to one running Turn and Step.
export function projectStreamingText(h, session) {
  const step = { step: 1, status: 'running', data: new Map() }
  const turn = { turn: 1, status: 'running', steps: [step], data: new Map() }
  const location = { kind: 'step', turn, step }
  const matches = session.eventSource
    .getSnapshot()
    .entries.map(entry => ({ ...entry, location }))
    .filter(match => h.assistantDefinition.match(match.event) !== null)
  const context = { key: 'assistant:1:1', id: '1:1', matches, current: new Map() }
  const assistant = h.assistantDefinition.buildLocationData(context, 'step')
  if (assistant === null) return { text: '', process: null }
  step.data.set(assistant.key, assistant.value)
  const process = h.turnProcessDefinition.buildLocationData(context, 'turn')
  const node = h.assistantDefinition.buildViewNode(context)
  return {
    text:
      node?.data.blocks
        .filter(block => block.kind === 'text')
        .map(block => block.text)
        .join('') ?? '',
    process: process?.value ?? null,
  }
}
