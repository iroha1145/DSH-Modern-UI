/** Explicit model-selector owner; the bundle disables the official presentation entry. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { CommandUiContract, SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { IconDataOutlineRegular } from '@iroha1145/dsh-modern-ui/primitives'
import { ModelSeat } from './model-extras.tsx'
import { createCodexSpeed } from './model-extras-codex.ts'
import { ModelDirectoryResolver } from './vendor/model/client/service.ts'
import { orderModelProviders } from './vendor/model/client/provider-order.ts'
import { MODEL_PICKER_NAMESPACE, type ModelPickerSettings } from './vendor/model/model-settings.ts'
import type {} from './contracts.ts'

/** Child slot for rows a provider's plugin shows beside the model button (see model-extras.tsx). */
const MODEL_PARAMETERS = 'conversation.input.model.parameters'

/** One selectable row's id: an opaque row key (resolved by lookup, never parsed). */
function rowId(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`
}

/** Flatten the directory into popup rows; failure rows are listed for visibility but never selectable. */
function optionsOf(directory: ModelDirectoryState, t: TranslateNS<'modern-model'>): SelectOption[] {
  const rows: SelectOption[] = []
  for (const group of orderModelProviders(directory.groups)) {
    const name = group.id === 'deepseek-account' ? t('provider.account') : group.name
    for (const model of group.models) {
      rows.push({
        id: rowId(group.id, model.id),
        label: model.name,
        group: { name: group.id, label: name },
        ...(directory.current !== null && directory.current.provider === group.id && directory.current.model === model.id ? { active: true } : {}),
      })
    }
  }
  for (const failure of directory.failures) {
    rows.push({
      id: `failure/${failure.id}`,
      label: failure.id === 'deepseek-account' ? t('provider.account') : failure.name,
      detail: t('option.loadError', { message: failure.message }),
    })
  }
  return rows
}

/**
 * Resolve a picked row back to its model selection by matching against the loaded
 * groups (the same data the rows were built from — ids stay opaque).
 * @param state - the session's directory snapshot.
 * @param id - the picked row id.
 * @returns the row's model selection, or undefined for failure rows / stale ids.
 */
function selectionOf(state: ModelDirectoryState, id: string): ModelSelection | undefined {
  for (const group of state.groups) {
    for (const model of group.models) {
      if (rowId(group.id, model.id) !== id) continue
      const sameRoute = state.current?.provider === group.id && state.current.model === model.id
      const reasoningEffort = sameRoute ? (state.current?.reasoningEffort ?? model.reasoning?.defaultEffort) : model.reasoning?.defaultEffort
      return {
        provider: group.id,
        model: model.id,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      }
    }
  }
  return undefined
}

export const inject = ['commandUi', 'locale', 'sessions', 'slots', 'remote', 'remote.session', 'configForms']

export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind('modern-model')
  ctx.plugin(ModelDirectoryResolver)
  const form = ctx.configForms.get<ModelPickerSettings>(MODEL_PICKER_NAMESPACE)
  const picker = createSnapshotStore(form.getSnapshot().value)
  ctx.effect(() => form.subscribe(() => picker.set(form.getSnapshot().value)))
  // Keep the official /model command over the same directory as the composer.
  ctx.inject(['commandUi', 'modelDirectories'], (scope: ClientContext) => {
    const command = scope.get('commandUi') as CommandUiContract
    const models = scope.modelDirectories
    const sessions = scope.sessions
    scope.effect(
      () =>
        command.register({
          name: 'model',
          label: () => t('command.label'),
          description: () => t('command.description'),
          icon: IconDataOutlineRegular,
          available: session => sessions.subagentAddress(session.sessionId) === undefined,
          ui: {
            kind: 'popupSelect',
            searchMode: 'fuzzy-label',
            searchLabels: () => ({
              placeholder: t('search.placeholder'),
              empty: t('empty.models'),
              noResults: t('search.empty'),
            }),
            options: async session => {
              if (sessions.subagentAddress(session.sessionId) !== undefined) {
                throw new Error('model selection is unavailable for addressed subagent sessions')
              }
              return optionsOf(await models.directoryFor(session.sessionId).load(), t)
            },
            onSelect: async (option, session) => {
              if (sessions.subagentAddress(session.sessionId) !== undefined) {
                throw new Error('model selection is unavailable for addressed subagent sessions')
              }
              const directory = models.directoryFor(session.sessionId)
              const selection = selectionOf(directory.store.getSnapshot(), option.id)
              if (selection === undefined) {
                throw new Error("this provider's catalog failed to load — pick a model from a loaded group")
              }
              const result = await directory.select(selection)
              if (!result.ok) {
                if (result.error.code === 'session/writer-held') throw new Error(t('error.sessionInUse'))
                throw result.error
              }
            },
          },
        }),
      'ui-model-selection: /model contribution',
    )
  })

  // The Codex subscription plugin keeps its speed setting behind endpoints of its own on the shared channel. The
  // connection is read at call time and nothing here depends on it: without it, or without that plugin, the call
  // fails and the provider menu shows no speed choice.
  const codex = createCodexSpeed(async (endpoint, payload) => {
    const connection = ctx.get('connection') as Partial<Pick<ConnectionHandle, 'rpc'>> | undefined
    if (typeof connection?.rpc?.call !== 'function') throw new Error('The connection offers no RPC calls')
    return connection.rpc.call('/api', `codex-subscription/${endpoint}`, payload)
  })
  const codexVerbs = { refresh: codex.refresh, choose: codex.choose }
  // A new connection may be a restarted Host with other plugins; ask again only where the answer was in use.
  ctx.on('connection/reset', () => {
    codex.reset()
  })

  ctx.inject(['slots', 'modelDirectories'], scope => {
    const models = scope.modelDirectories
    const modelParameters: ObservableSnapshot<number> = {
      getSnapshot: () => scope.slots.entries(MODEL_PARAMETERS).length,
      subscribe: listener => scope.slots.subscribe(MODEL_PARAMETERS, listener),
    }
    scope.slots.inject('conversation.input.model', () =>
      scope.slots.register(
        {
          name: 'conversation.input.model',
          locale: 'modern-model',
          // Not zero, on purpose. The Codex subscription plugin puts a model picker of its own in this seat whenever
          // every other entry sits at priority 0, which its "auto" mode reads as "only the official picker is here";
          // any other value tells it the seat is taken. Its picker registers at -1, so someone who asks that plugin
          // for its own picker still gets it. A fraction cannot meet another plugin's whole number, and a single
          // slot refuses two entries at one priority.
          priority: -0.5,
          children: {
            'conversation.input.model.label': { kind: 'single', scope: 'session', inline: true },
            // A list: each provider's plugin adds its rows and renders nothing for other providers' models.
            [MODEL_PARAMETERS]: { kind: 'list', scope: 'session' },
          },
          inject: sessionId => {
            const directory = models.directoryFor(sessionId)
            const available = scope.sessions.subagentAddress(sessionId) === undefined
            return {
              available,
              hooks: { modelDirectory: directory.store, modelPicker: picker, modelParameters, codexSpeed: codex.store },
              codex: codexVerbs,
              load: () => {
                if (available) void directory.load().catch(() => {})
              },
              select: selection => (available ? directory.select(selection) : Promise.resolve(undefined)),
            }
          },
        },
        ModelSeat,
      ),
    )
  })
}

export const modelOwner = { name: 'modern-model-owner', inject, apply }
