/** Resolve plan-owned files without borrowing the currently selected conversation. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import { fileMediaUrl, isAbsoluteWorkspacePath, resolveWorkspacePath, sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import type { MarkdownDelegate } from '../../primitives/markdown/MarkdownDelegate.tsx'

/** Mirror the official plan/review resource grammar, whose parser is not publicly exported. */
export function planSessionId(address: string): SessionId | undefined {
  const match = /^dsh-resource:\/\/(plan|plan-review)\/([^?#]+)$/.exec(address)
  if (match === null) return undefined
  let parts: string[]
  try { parts = match[2]!.split('/').map(decodeURIComponent) } catch { return undefined }
  if (parts.some(part => part === '')) return undefined
  if (parts.length === 2) return parts[0] as SessionId
  if (match[1] === 'plan' && parts.length === 5 && parts[0] === 'subagent'
    && ['one-shot', 'continuable', 'unknown'].includes(parts[3]!)) return parts[2] as SessionId
  return undefined
}

/** Build file capabilities from the plan's own retained binding or catalog entry. */
export function planNavigation(ctx: Context, address: string, labels: NonNullable<MarkdownDelegate['fileImages']>['labels']): MarkdownDelegate {
  const sessionId = planSessionId(address)
  if (sessionId === undefined) return {}
  const known = () => ctx.sessions.binding(sessionId) !== undefined || ctx.sessions.list.getSnapshot().byId[sessionId] !== undefined
  if (!known()) return {}
  const resolve = (path: string): string | undefined => {
    if (!known()) return undefined
    const binding = ctx.sessions.binding(sessionId)
    const current = binding?.session.projections.faceOf('workingDirectory').getSnapshot() as string | null | undefined
    const cwd = current ?? ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
    const resolved = resolveWorkspacePath(cwd, path)
    return isAbsoluteWorkspacePath(resolved) ? resolved : undefined
  }
  return {
    openFile: (path, options) => {
      const resolved = resolve(path)
      if (resolved === undefined) return
      const address = sessionFileAddress(sessionId, resolved)
      if (options?.line === undefined) ctx.sidebarRight.openResource(address)
      else ctx.sidebarRight.openResource(address, { params: { line: options.line } })
    },
    fileImages: {
      resolve: path => {
        const resolved = resolve(path)
        return resolved === undefined ? undefined : fileMediaUrl(document.baseURI, resolved)
      },
      labels,
    },
  }
}
