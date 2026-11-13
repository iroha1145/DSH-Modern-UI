import type { Context } from '@deepseek-ai/cordis'
import type {} from './contracts.ts'
import { dictionaries } from './locale-dictionaries.ts'
import { installThemeStyles } from './vendor/theme/client/styles.ts'
import { installIconSprite } from './vendor/theme/client/icon-sprite.ts'
import * as chatLocale from './vendor/chat/client/locale.ts'
import type { ThemeInjected } from './vendor/intelligent/client/OpenUIBlock.tsx'
import { OpenUILoader as OpenUIBlock } from './vendor/intelligent/client/OpenUILoader.tsx'
import { looksLikeOpenUI } from './vendor/intelligent/client/openui-source.ts'
import { Followups } from './vendor/intelligent/client/Followups.tsx'
import * as intelligentLocale from './vendor/intelligent/client/locales.ts'
import * as modelLocale from './vendor/model/client/locales.ts'
import { MODEL_PICKER_NAMESPACE } from './vendor/model/model-settings.ts'
import type { ModelPickerSettings } from './vendor/model/model-settings.ts'
import { registerModelPickerSettings } from './vendor/model/client/settings/register.ts'
import { registerReasoningDeclaration, PI_AI_NAMESPACE } from './vendor/settings-models/client/register.ts'
import { EFFORT_SHORT } from './vendor/model/client/profiles.ts'
import { ModelCatalogDirectory, refreshOnModelsUpdated } from './vendor/model/client/catalog.ts'
import { ModelDirectoryResolver } from './vendor/model/client/service.ts'
import { installPluginStyles } from './styles.ts'
import { installHighlighting } from './vendor/primitives/markdown/highlight.ts'
import { AgentsView } from './vendor/subagent/client/agent-tree/AgentsView.tsx'
import { SubagentHeaderLineage, SubagentCatalogAction } from './vendor/subagent/client/SubagentHeaderLineage.tsx'
import * as subagentLocale from './vendor/subagent/client/locales.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import { installLanguages } from './languages.ts'
import { installReasoningTranslation } from './reasoning-translation.ts'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-browser/client'
import { installSteeringBatches } from './steering-batches.ts'
import { installToolCards } from './tool-cards.tsx'
import { installPreviews } from './previews.ts'
import { apply as applyChat } from './vendor/chat/client/apply.ts'
// Global sheet over surfaces the official packages still render (see the file's header).
import './official-surfaces.css'
import { layoutOwner } from './layout-owner.ts'
import { workspaceOwner } from './workspace-owner.ts'
import { sidebarOwner } from './sidebar-owner.ts'
import { settingsOwner } from './settings-owner.ts'
import { modelOwner } from './model-owner.ts'
import { installFileDrag } from './file-drag.ts'
import { bindHostContract } from './host-contract.ts'
import { installQuotes } from './quotes.ts'
import { installPresentationParity } from './presentation-parity.ts'
import { installPresentationSettings } from './presentation-settings.tsx'
import { installJevSettings } from './jev-settings.tsx'
import { installPluginDocuments } from './plugin-documents/index.tsx'
import { installOfficialControls } from './official-controls.ts'
import { installCommunityMarkdown } from './community-markdown.ts'
import * as conversationOwner from './conversation-owner.ts'
import { installDesktopOnboarding } from './desktop-onboarding.ts'
import { installConversationLayout } from './conversation-layout.tsx'

export const inject = ['slots', 'theme', 'locale', 'configForms', 'remote', 'remote.session']
/** The sprite installer, exported so a test can mount a second owner without a second plugin instance. */
export { installIconSprite }

/** Mount selected Modern owners before dependent presentation cells. */
export async function apply(ctx: Context): Promise<void> {
  // First, so every owner mounted below already reads Session snapshots the way the running Host publishes them.
  ctx.effect(() => {
    bindHostContract(ctx)
    return () => {
      bindHostContract(undefined)
    }
  })
  installPluginStyles(ctx)
  installHighlighting(ctx)
  installThemeStyles(ctx)
  installIconSprite(ctx)
  installOfficialControls(ctx)
  ctx.effect(() => ctx.locale.register('modern-intelligent', dictionaries(intelligentLocale)))
  ctx.effect(() => ctx.locale.register('modern-model', dictionaries(modelLocale)))
  ctx.effect(() => ctx.locale.register('modern-subagent', dictionaries(subagentLocale)))
  ctx.effect(() => ctx.locale.register('modern-chat', dictionaries(chatLocale)))
  installCommunityMarkdown(ctx)
  installLanguages(ctx)
  installFileDrag(ctx)
  installDesktopOnboarding(ctx)
  installConversationLayout(ctx)
  const owners = [
    ctx.plugin(layoutOwner),
    ctx.plugin(workspaceOwner),
    ctx.plugin(sidebarOwner),
    ctx.plugin(conversationOwner),
    ctx.plugin(settingsOwner),
    ctx.plugin(modelOwner),
  ]
  ctx.inject(['modelDirectories', 'sessions', 'sidebarRight'], installPresentation)
  for (const owner of owners) await owner.await()
}

/**
 * The catalog the model picker settings show. The model owner's resolver already loads it and reloads it on every
 * Host model event; a second directory would repeat each of those catalog reads.
 * @param ctx - the presentation context, which injects `modelDirectories`.
 * @returns the resolver's catalog, or an own one when another owner provides the service.
 */
function modelCatalog(ctx: Context): ModelCatalogDirectory {
  const directories: unknown = ctx.modelDirectories
  if (directories instanceof ModelDirectoryResolver) return directories.catalog
  const catalog = new ModelCatalogDirectory(ctx)
  ctx.on('connection/reset', () => catalog.resetGeneration())
  ctx.remote.$on('llm/adapters-updated', () => catalog.refresh())
  refreshOnModelsUpdated(ctx, catalog)
  ctx.remote.$on('settings/document-updated', () => catalog.refresh())
  ctx.remote.$on('credentials/record-updated', () => catalog.refresh())
  ctx.remote.$on('credentials/reference-updated', () => catalog.refresh())
  return catalog
}

function installPresentation(ctx: Context): void {
  installQuotes(ctx)
  installPresentationParity(ctx)
  installPluginDocuments(ctx)
  installReasoningTranslation(ctx)
  installSteeringBatches(ctx)
  installToolCards(ctx)
  // Markdown file preview and plan preview bodies, drawn through the Modern MarkdownText (code fences fold).
  installPreviews(ctx)
  // The patched Chat target replaces the official ui-chat entry outright (cordis.patch.yml disables
  // it): data layer, view, flow, node views, factories, quota notice, stats pills and settings rows.
  ctx.inject(['uiWorkspace', 'uiSession', 'uiConversation', 'connection', 'sidebarRight'], applyChat)
  const form = ctx.configForms.get<ModelPickerSettings>(MODEL_PICKER_NAMESPACE)
  const t = ctx.locale.bind('modern-model')
  const catalog = modelCatalog(ctx)
  registerModelPickerSettings(ctx, {
    form,
    catalog: catalog.store,
    loadCatalog: () => {
      void catalog.load().catch(() => {})
    },
    blurb: key => t(`preset.${key}`),
    effortName: (id, fallback) => {
      const key = EFFORT_SHORT.get(id)
      return key === undefined ? fallback : t(key)
    },
  })
  // Per-model reasoning declarations for pi-ai routes whose model is newer than the installed
  // catalog: a block in each pi-ai provider card, writing the stored models list through the
  // shared settings form. The official editor keeps every hidden field on save (verified against
  // rc.4, see docs/history/reasoning-and-preview-fold-20261028.md), so the two never fight over the row.
  ctx.inject(['remote.llm', 'settingsSchema'], scope =>
    registerReasoningDeclaration(scope, {
      namespace: PI_AI_NAMESPACE,
      form: scope.configForms.get<Record<string, unknown>>(PI_AI_NAMESPACE),
      describe: scope.configForms.describe(),
      schema: scope.settingsSchema,
      discoverCatalog: async provider => {
        const answer = await scope.remote.llm.discoverModels(PI_AI_NAMESPACE, { provider })
        return answer.ok ? answer.value.map(model => model.id) : undefined
      },
    }),
  )
  // Code-fence presenters beside the standard CodeBlock (priority 100, registered by the chat entry).
  // Each follows its `presentation` switch: a fence whose presenter is off renders as plain code.
  const presentation = installPresentationSettings(ctx)
  // The optional Jev row needs the credentials Remote; without it the row is simply absent.
  ctx.inject(['remote.credentials'], scope => {
    installJevSettings(scope, presentation)
  })
  ctx.slots.inject('conversation.chat.message.code', () => {
    const presenters = {
      openui: () =>
        ctx.slots.register(
          {
            name: 'conversation.chat.message.code',
            locale: 'modern-intelligent',
            priority: 0,
            // `openui-lang` is the taught fence; a plain `openui` fence counts when its body reads as openui-lang,
            // so HTML visualizations in older answers stay readable code.
            select: owner => {
              const lang = owner.lang?.trim().toLowerCase()
              return lang === 'openui-lang' || (lang === 'openui' && looksLikeOpenUI(owner.code)) ? {} : null
            },
            inject: (): ThemeInjected => ({
              hooks: {
                uiLocale: ctx.locale,
                theme: {
                  getSnapshot: () => ctx.theme.getTheme(),
                  subscribe: listener => ctx.on('theme/change', listener),
                },
              },
            }),
          },
          OpenUIBlock,
        ),
      followups: () =>
        ctx.slots.register(
          {
            name: 'conversation.chat.message.code',
            locale: 'modern-intelligent',
            priority: 0,
            select: owner => (owner.lang?.trim().toLowerCase() === 'followups' ? {} : null),
          },
          Followups,
        ),
    }
    const live: Partial<Record<keyof typeof presenters, () => void>> = {}
    const sync = () => {
      const switches = presentation.getSnapshot()
      for (const key of ['openui', 'followups'] as const) {
        const dispose = live[key]
        if (switches[key] && dispose === undefined) live[key] = presenters[key]()
        else if (!switches[key] && dispose !== undefined) {
          dispose()
          delete live[key]
        }
      }
    }
    sync()
    const stop = presentation.subscribe(sync)
    return () => {
      stop()
      for (const dispose of Object.values(live)) dispose()
    }
  })
  ctx.inject(['uiWorkspace', 'sidebarRight'], scope => {
    const actions = () => ({
      openChild: (address: SubagentAddress) => scope.uiWorkspace.openSession(address),
      openChildAside: (address: SubagentAddress) => {
        const query = new URLSearchParams({ parent: address.parentSessionId, mode: address.mode })
        scope.sidebarRight.openResource(`dsh-resource://subagentchat/session/${encodeURIComponent(address.childSessionId)}?${query}`, {
          kind: 'subagentchat',
          preferNewPane: true,
        })
      },
      refreshProjection: (sessionId: SessionId) => {
        void scope.sessions.refreshProjections(sessionId)
      },
    })
    scope.slots.inject('conversation.session.header.lineage', () =>
      scope.slots.register(
        {
          name: 'conversation.session.header.lineage',
          priority: -100,
          locale: 'modern-subagent',
          inject: actions,
        },
        SubagentHeaderLineage,
      ),
    )
    scope.slots.inject('conversation.session.header.actions', () =>
      scope.slots.register(
        {
          name: 'conversation.session.header.actions',
          id: 'subagent-catalog',
          priority: -100,
          order: 10,
          locale: 'modern-subagent',
          inject: actions,
        },
        SubagentCatalogAction,
      ),
    )
    const translate = scope.locale.bind('modern-subagent')
    scope.slots.inject('conversation.view', () =>
      scope.slots.register(
        {
          name: 'conversation.view',
          id: 'agents',
          priority: -100,
          order: 5,
          locale: 'modern-subagent',
          label: () => translate('view.agents'),
          inject: () => ({
            openSession: sessionId => scope.uiWorkspace.openSession(scope.sessions.subagentAddress(sessionId) ?? sessionId),
            refreshProjections: sessionId => {
              void scope.sessions.refreshProjections(sessionId)
            },
          }),
        },
        AgentsView,
      ),
    )
  })
}
