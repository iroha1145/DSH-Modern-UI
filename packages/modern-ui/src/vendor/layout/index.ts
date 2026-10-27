// Derived from deepseek-ai/deepseek-harness (MIT); see package LICENSE.
/**
 * Layout plugin, browser half: one register() call contributes AppFrame into
 * the runtime's built-in 'root' slot and, in the same breath, declares the
 * child slots (declaration = exclusive render authority), seats the
 * layout store (panel geometry), and wires the panel-action service face.
 * ctx.layout selects the main panel and controls column geometry; Session
 * selection belongs to the Session Controller. A second effect seats the theme
 * presenter, which projects ctx.theme snapshots onto document.body.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ModernLayout } from './modern-layout.ts'
import { AppFrame } from './AppFrame.tsx'
import { createLayoutStore } from './stores.ts'
import { LayoutController } from './service.ts'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { en, ja, es, fr, de, ru, pt, zh } from './shortcut-locales.ts'
import { ThemePresenter } from './theme-presenter.ts'

/** Required services (cordis fiber inject — the loader passes all module exports as an object plugin). */
export const inject = ['slots', 'theme', 'locale', 'shortcuts']

/**
 * Client plugin body: provide ctx.layout, then one register() call — AppFrame
 * into 'root' with its child-slot declarations, the layout store seat,
 * and the shared root instance supplying commands and the panel-info source.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const dictionaries = { zh, en, ja, es, fr, de, ru, pt }
  ctx.effect(() => ctx.locale.register('modern-layout-shortcuts', dictionaries), 'layout: command labels')
  const t = ctx.locale.bind('modern-layout-shortcuts')

  ctx.effect(() => {
    const handle = createLayoutStore()
    const instance = handle.create()
    const store: typeof handle = { ...handle, create: () => instance }
    const retainMainPanels = (): void => {
      instance.actions.retainMainPanels(ctx.slots.entries('main').flatMap(entry =>
        entry.options.key === undefined ? [] : [entry.options.key]))
    }
    const panelInfo: HostObservable<PanelInfo> = {
      getSnapshot: () => instance.getSnapshot().panelInfo,
      subscribe: listener => instance.subscribe(listener),
    }
    const layout = new LayoutController(instance.actions, id =>
      ctx.slots.entries('main').some(entry => entry.options.key === id), panelInfo)
    const disposePanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo: layout.panelInfo } })
    const disposeService = ctx.reflect.provide('layout', layout)
    let viewportSnapshot = { mobile: instance.getSnapshot().layoutInfo.viewportWidth <= 640 }
    const modernLayout: ModernLayout = {
      viewport: {
        getSnapshot: () => {
          const mobile = instance.getSnapshot().layoutInfo.viewportWidth <= 640
          if (viewportSnapshot.mobile !== mobile) viewportSnapshot = { mobile }
          return viewportSnapshot
        },
        subscribe: instance.subscribe,
      },
      closeMobileSidebar: () => {
        const info = instance.getSnapshot().layoutInfo
        if (info.viewportWidth <= 640 && info.narrowExpanded) instance.actions.toggleSidebar()
      },
    }
    const disposeModernLayout = ctx.reflect.provide('modernLayout', modernLayout)
    const disposeRegistration = ctx.slots.register({
      name: 'root',
      locale: 'common',
      children: {
        'sidebar': { kind: 'single', scope: 'root' },
        'main': { kind: 'keyed', scope: 'root' },
        'rightbar': { kind: 'single', scope: 'root' },
        'shell.bottom': { kind: 'single', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
        'shell.leading': { kind: 'single', scope: 'root' },
      },
      store,
    }, AppFrame)
    const disposeShortcut = ctx.shortcuts.register({
      id: 'sidebar.left.toggle' as ShortcutCommandId, label: () => t('toggle'), aliases: ['sidebar', 'toggle left sidebar'],
      defaults: {
        'desktop:macos': { code: 'KeyB', modifiers: ['primary'] },
        'desktop:windows': { code: 'KeyB', modifiers: ['primary'] },
        'desktop:linux': { code: 'KeyB', modifiers: ['primary'] },
        'web:macos': { code: 'KeyB', modifiers: ['primary', 'alt'] },
        'web:windows': { code: 'KeyB', modifiers: ['primary', 'alt'] },
      },
      regions: ['page', 'editable'], modals: [],
      resolve: () => ({ status: 'handled', run: () => { layout.toggleSidebar() } }),
    })
    const disposePanels = ctx.slots.subscribe('main', retainMainPanels)
    retainMainPanels()
    return () => {
      disposeShortcut()
      layout.dispose()
      disposePanels()
      disposeRegistration()
      disposePanelInfo()
      // provide()'s disposer settles asynchronously; teardown is synchronous fire-and-forget.
      void disposeModernLayout()
      void disposeService()
    }
  }, 'ui-layout: service + root registration')

  // Theme presentation: pure DOM writes from resolved snapshots — initial
  // state through the getter once, then event-driven only; no React path.
  ctx.effect(() => {
    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', (snapshot) => { presenter.apply(snapshot) })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'ui-layout: theme presenter')
}

declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'modern-layout-shortcuts': keyof typeof zh } }
