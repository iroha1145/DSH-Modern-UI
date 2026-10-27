import type { Context } from '@deepseek-ai/cordis'
import type {} from './contracts.ts'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { installThemeStyles } from './vendor/theme/client/styles.ts'
import { installIconSprite } from './vendor/theme/client/icon-sprite.ts'
import { AssistantNodeView } from './vendor/chat/client/chat/AssistantNodeView.tsx'
import { MessageCode } from './vendor/chat/client/chat/MessageCode.tsx'
import { ReasoningContent } from './vendor/chat/client/chat/ReasoningContent.tsx'
import * as chatLocale from './vendor/chat/client/locale.ts'
import { MessageImages } from './vendor/attachment/client/MessageImages.tsx'
import { IntelligentUI, type ThemeInjected } from './vendor/intelligent/client/IntelligentUI.tsx'
import { Followups } from './vendor/intelligent/client/Followups.tsx'
import * as intelligentLocale from './vendor/intelligent/client/locales.ts'
import * as modelLocale from './vendor/model/client/locales.ts'
import { ModelSelect } from './vendor/model/client/ModelSelect.tsx'
import { MODEL_PICKER_NAMESPACE } from './vendor/model/model-settings.ts'
import type { ModelPickerSettings } from './vendor/model/model-settings.ts'
import { registerModelPickerSettings } from './vendor/model/client/settings/register.ts'
import { EFFORT_SHORT } from './vendor/model/client/profiles.ts'
import { ModelCatalogDirectory } from './vendor/model/client/catalog.ts'
import { installPluginStyles } from './styles.ts'
import { AgentsView } from './vendor/subagent/client/agent-tree/AgentsView.tsx'
import { SubagentHeaderLineage, SubagentCatalogAction } from './vendor/subagent/client/SubagentHeaderLineage.tsx'
import * as subagentLocale from './vendor/subagent/client/locales.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import { presentationPolicyFor } from './vendor/chat/client/presentation-policy.ts'
import { DEFAULT_LINK_OPENING, type ChatSettings, type FoldedReplies } from './vendor/chat/chat-settings.ts'
import { RunningStatusHost } from './vendor/chat/client/chat/RunningStatusHost.tsx'
import { FoldedRepliesRow, type FoldedRepliesRowInjected } from './vendor/chat/client/settings/FoldedRepliesRow.tsx'
import { installLanguages } from './languages.ts'
import { installReasoningTranslation } from './reasoning-translation.ts'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-browser/client'
import { installSteeringBatches } from './steering-batches.ts'
import { installToolCards } from './tool-cards.tsx'
import { layoutOwner } from './layout-owner.ts'
import { workspaceOwner } from './workspace-owner.ts'
import { sidebarOwner } from './sidebar-owner.ts'
import { settingsOwner } from './settings-owner.ts'
import * as conversationOwner from './conversation-owner.ts'
import { TurnProcessNodeView } from './vendor/chat/client/chat/TurnProcessNodeView.tsx'
import {
  UserMessageNodeView, SteeringMessageNodeView, ContextMessageNodeView, RetryNodeView, TurnErrorNodeView,
  TurnMaxTokensNodeView, CompactionNodeView, ManualCompactionNodeView, UnknownNodeView,
} from './vendor/chat/client/chat/MessageItem.tsx'

export const inject = ['slots', 'theme', 'locale', 'configForms', 'remote', 'remote.session']

const LANGUAGES = ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt'] as const
const dictionaries = <D extends Record<string, string>>(source: Record<typeof LANGUAGES[number], D>) => ({
  zh: source.zh, en: source.en, ja: source.ja, es: source.es, fr: source.fr, de: source.de, ru: source.ru, pt: source.pt,
})

/** Mount selected Modern owners before dependent presentation cells. */
export async function apply(ctx: Context): Promise<void> {
  installPluginStyles(ctx)
  installThemeStyles(ctx)
  installIconSprite(ctx)
  ctx.effect(() => ctx.locale.register('modern-intelligent', dictionaries(intelligentLocale)))
  ctx.effect(() => ctx.locale.register('modern-model', dictionaries(modelLocale)))
  ctx.effect(() => ctx.locale.register('modern-subagent', dictionaries(subagentLocale)))
  ctx.effect(() => ctx.locale.register('modern-chat', dictionaries(chatLocale)))
  installLanguages(ctx)
  const owners = [
    ctx.plugin(layoutOwner),
    ctx.plugin(workspaceOwner),
    ctx.plugin(sidebarOwner),
    ctx.plugin(conversationOwner),
    ctx.plugin(settingsOwner),
  ]
  ctx.inject(['modelDirectories', 'sessions', 'sidebarRight'], installPresentation)
  for (const owner of owners) await owner.await()
}

/** Chat preferences the plugin keeps in its own settings namespace. */
interface ModernChatSettings { foldedReplies?: FoldedReplies }
const MODERN_SETTINGS_NAMESPACE = 'modern-ui'
const foldedRepliesOf = (value: ModernChatSettings | undefined): FoldedReplies => value?.foldedReplies === 'final' ? 'final' : 'all'

function installPresentation(ctx: Context): void {
  installReasoningTranslation(ctx)
  installSteeringBatches(ctx)
  installToolCards(ctx)
  // The official flow keeps its "deep diving" running row and offers no slot for it; Modern hides
  // that row's children by style and renders the patched running status into it from an
  // always-mounted composer-dock entry (see RunningStatusHost).
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock', id: 'modern-running-status', order: -100, locale: 'modern-chat',
  }, RunningStatusHost))
  const modernChat = ctx.configForms.get<ModernChatSettings>(MODERN_SETTINGS_NAMESPACE)
  const foldedReplies = createSnapshotStore<FoldedReplies>(foldedRepliesOf(modernChat.getSnapshot().value))
  ctx.effect(() => modernChat.subscribe(() => foldedReplies.set(foldedRepliesOf(modernChat.getSnapshot().value))))
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'modern-folded-replies', order: 13, locale: 'modern-chat',
    inject: (): FoldedRepliesRowInjected => ({
      hooks: { foldedReplies },
      setFoldedReplies: (replies) => {
        foldedReplies.set(replies)
        void modernChat.set('foldedReplies', replies).catch((_error: unknown) => {
          // The local choice remains usable when persistence is unavailable.
        })
      },
    }),
  }, FoldedRepliesRow))
  const form = ctx.configForms.get<ModelPickerSettings>(MODEL_PICKER_NAMESPACE)
  const picker = createSnapshotStore(form.getSnapshot().value)
  ctx.effect(() => form.subscribe(() => picker.set(form.getSnapshot().value)))
  const t = ctx.locale.bind('modern-model')
  const models = ctx.modelDirectories
  const catalog = new ModelCatalogDirectory(ctx)
  ctx.on('connection/reset', () => catalog.resetGeneration())
  ctx.remote.$on('llm/adapters-updated', () => catalog.refresh())
  ctx.remote.$on('settings/document-updated', () => catalog.refresh())
  ctx.remote.$on('credentials/record-updated', () => catalog.refresh())
  ctx.remote.$on('credentials/reference-updated', () => catalog.refresh())
  registerModelPickerSettings(ctx, {
    form,
    catalog: catalog.store,
    loadCatalog: () => { void catalog.load().catch(() => {}) },
    blurb: key => t(`preset.${key}`),
    effortName: (id, fallback) => {
      const key = EFFORT_SHORT.get(id)
      return key === undefined ? fallback : t(key)
    },
  })
  ctx.slots.inject('conversation.input.model', () => ctx.slots.register({
    name: 'conversation.input.model', priority: -100, locale: 'modern-model',
    children: { 'modern.conversation.input.model.label': { kind: 'single', scope: 'session', inline: true } },
    inject: sessionId => {
      const directory = models.directoryFor(sessionId)
      const available = ctx.sessions.subagentAddress(sessionId) === undefined
      return {
        available,
        hooks: { modelDirectory: directory.store, modelPicker: picker },
        load: () => { if (available) void directory.load().catch(() => {}) },
        select: selection => available ? directory.select(selection) : Promise.resolve(undefined),
      }
    },
  }, ModelSelect))

  // This renderer owns distinct child declarations; official children remain untouched.
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'assistant-step', priority: -100, locale: 'modern-chat',
    children: {
      'modern.conversation.chat.reasoning.body': { kind: 'single', scope: 'session' },
      'modern.conversation.chat.message.images': { kind: 'single', scope: 'session' },
      'modern.conversation.chat.message.code': { kind: 'chain', scope: 'session' },
    },
    inject: () => ({ hooks: { presentation: presentationSource(ctx) },
      openExternalLink: (url: string) => {
        const opening = ctx.configForms.get<ChatSettings>('ui-chat').getSnapshot().value?.linkOpening ?? DEFAULT_LINK_OPENING
        if (opening === 'sidebar' && ctx.get('sidebarRightTabs')?.get('browser') !== undefined) ctx.sidebarRight.openTab('browser', { params: { url } })
        else window.open(url, '_blank', 'noopener,noreferrer')
      },
    }),
  }, AssistantNodeView))
  ctx.slots.inject('conversation.chat.node', function* () {
    const options = { name: 'conversation.chat.node', priority: -100, locale: 'modern-chat' } as const
    yield ctx.slots.register({ ...options, key: 'user' }, UserMessageNodeView)
    yield ctx.slots.register({ ...options, key: 'context' }, ContextMessageNodeView)
    yield ctx.slots.register({ ...options, key: 'model-retry' }, RetryNodeView)
    yield ctx.slots.register({ ...options, key: 'turn-error' }, TurnErrorNodeView)
    yield ctx.slots.register({ ...options, key: 'turn-max-tokens' }, TurnMaxTokensNodeView)
    yield ctx.slots.register({ ...options, key: 'compaction' }, CompactionNodeView)
    yield ctx.slots.register({ ...options, key: 'manual-compaction' }, ManualCompactionNodeView)
    yield ctx.slots.register({ ...options, key: 'turn-process' }, TurnProcessNodeView)
    yield ctx.slots.register({ ...options, key: 'unknown' }, UnknownNodeView)
  })
  ctx.inject(['uiConversation'], scope => scope.slots.inject('conversation.chat.node', () => scope.slots.register({
    name: 'conversation.chat.node', priority: -100, locale: 'modern-chat', key: 'steering',
    inject: sessionId => ({ hooks: { steeringBatches: scope.uiConversation.binding(sessionId).target('modern-steering') } }),
  }, SteeringMessageNodeView)))
  ctx.slots.inject('modern.conversation.chat.reasoning.body', () => ctx.slots.register({
    name: 'modern.conversation.chat.reasoning.body', locale: 'modern-chat',
  }, ReasoningContent))
  ctx.slots.inject('modern.conversation.chat.message.images', () => ctx.slots.register({
    name: 'modern.conversation.chat.message.images',
  }, MessageImages))
  ctx.slots.inject('modern.conversation.chat.message.code', function* () {
    yield ctx.slots.register({ name: 'modern.conversation.chat.message.code', priority: 100, select: () => ({}) }, MessageCode)
    yield ctx.slots.register({
      name: 'modern.conversation.chat.message.code', locale: 'modern-intelligent', priority: 0,
      select: owner => owner.lang?.trim().toLowerCase() === 'openui' ? {} : null,
      inject: (): ThemeInjected => ({ hooks: { theme: {
        getSnapshot: () => ctx.theme.getTheme(),
        subscribe: listener => ctx.on('theme/change', listener),
      } } }),
    }, IntelligentUI)
    yield ctx.slots.register({
      name: 'modern.conversation.chat.message.code', locale: 'modern-intelligent', priority: 0,
      select: owner => owner.lang?.trim().toLowerCase() === 'followups' ? {} : null,
    }, Followups)
  })
  ctx.inject(['uiWorkspace', 'sidebarRight'], scope => {
    const actions = () => ({
      openChild: (address: SubagentAddress) => scope.uiWorkspace.openSession(address),
      openChildAside: (address: SubagentAddress) => {
        const query = new URLSearchParams({ parent: address.parentSessionId, mode: address.mode })
        scope.sidebarRight.openResource(`dsh-resource://subagentchat/session/${encodeURIComponent(address.childSessionId)}?${query}`, { kind: 'subagentchat', preferNewPane: true })
      },
      refreshProjection: (sessionId: SessionId) => { void scope.sessions.refreshProjections(sessionId) },
    })
    scope.slots.inject('conversation.session.header.lineage', () => scope.slots.register({
      name: 'conversation.session.header.lineage', priority: -100, locale: 'modern-subagent', inject: actions,
    }, SubagentHeaderLineage))
    scope.slots.inject('conversation.session.header.actions', () => scope.slots.register({
      name: 'conversation.session.header.actions', id: 'subagent-catalog', priority: -100, order: 10,
      locale: 'modern-subagent', inject: actions,
    }, SubagentCatalogAction))
    const translate = scope.locale.bind('modern-subagent')
    scope.slots.inject('conversation.view', () => scope.slots.register({
      name: 'conversation.view', id: 'agents', priority: -100, order: 5, locale: 'modern-subagent',
      label: () => translate('view.agents'),
      inject: () => ({
        openSession: sessionId => scope.uiWorkspace.openSession(scope.sessions.subagentAddress(sessionId) ?? sessionId),
        refreshProjections: sessionId => { void scope.sessions.refreshProjections(sessionId) },
      }),
    }, AgentsView))
  })
}

function presentationSource(ctx: Context) {
  const settings = ctx.configForms.get<ChatSettings>('ui-chat')
  // Work-details mode and collapse timing stay with the official chat settings; the folded-reply
  // choice has no official field, so the plugin's own namespace holds it (a legacy ui-chat value
  // still counts until the profile migration has moved it).
  const modern = ctx.configForms.get<ModernChatSettings>(MODERN_SETTINGS_NAMESPACE)
  const value = () => {
    const current = settings.getSnapshot().value
    const saved = current?.transcriptView
    const mode = saved === 'compact' || saved === 'detailed' || saved === 'verbose' ? saved : 'standard'
    const replies = modern.getSnapshot().value?.foldedReplies ?? current?.foldedReplies
    return presentationPolicyFor(mode, current?.collapseTiming ?? 'completion', replies === 'final' ? 'final' : 'all')
  }
  let accepted = value()
  return {
    getSnapshot: () => accepted,
    subscribe: (listener: () => void) => {
      const refresh = () => { accepted = value(); listener() }
      const unsubscribe = [settings.subscribe(refresh), modern.subscribe(refresh)]
      return () => { for (const release of unsubscribe) release() }
    },
  }
}
