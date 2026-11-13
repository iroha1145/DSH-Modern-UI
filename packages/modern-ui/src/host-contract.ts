/**
 * Host contract differences one Modern build bridges across the supported official releases.
 *
 * The choice comes from the Host release identity the client module system publishes
 * (`ctx.modules.manifest.release`, present since 0.2.1-rc.2), never from method presence or
 * arity: the contracts below keep their method names and parameter counts across releases.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ISession } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-modules/client'

/**
 * How `Session.readAttachment` names the image it reads.
 * - `attachment-id`: 0.2.1 releases send the id as `request.attachmentId`; the Host looks the
 *   reference up in the Session history.
 * - `attachment-ref`: every 0.2.2 prerelease (alpha.2 onward) and later send the complete
 *   `ImageAttachmentRef` as `request.attachment`.
 */
export type AttachmentReadProtocol = 'attachment-id' | 'attachment-ref'

/**
 * Read the official release version the Host published in its boot graph.
 * @param ctx - any client context under the Host Loader.
 * @returns the release version, or undefined when the Host published none.
 */
export function hostReleaseVersion(ctx: Context): string | undefined {
  const version = ctx.get('modules')?.manifest.release?.version
  return typeof version === 'string' ? version : undefined
}

/**
 * Map a Host release version onto its attachment read protocol.
 * @param version - official release version, e.g. `0.2.1-rc.4` or `0.2.2-rc.1`.
 * @returns the protocol, or undefined for a missing or unparseable version.
 */
export function attachmentReadProtocol(version: string | undefined): AttachmentReadProtocol | undefined {
  const match = version === undefined ? null : /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version)
  if (match === null) return undefined
  const [major, minor, patch] = match.slice(1, 4).map(Number) as [number, number, number]
  // Prerelease tags do not matter here: every published 0.2.2 prerelease already takes the reference.
  const newer = major > 0 || minor > 2 || (minor === 2 && patch >= 2)
  return newer ? 'attachment-ref' : 'attachment-id'
}

/**
 * Whether a Host release reports if a continuable subagent's parent Session is reachable
 * (`SessionSnapshot.subagent.parentAvailable`: undefined while the parent is being resolved, then
 * true or false). Releases up to 0.2.2-rc.1 do. 0.2.2-rc.2 removed the field together with the
 * agent ownership relation: a continuable subagent takes input whatever its parent does, and the
 * official conversation tests the mode alone.
 * @param version - official release version, e.g. `0.2.2-rc.1`.
 * @returns false from 0.2.2-rc.2 on; true before it and for a missing or unparseable version.
 */
export function hostReportsParentAvailability(version: string | undefined): boolean {
  const match = version === undefined ? null : /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(version)
  if (match === null) return true
  const [major, minor, patch] = match.slice(1, 4).map(Number) as [number, number, number]
  if (major !== 0 || minor !== 2 || patch !== 2) return major === 0 && (minor < 2 || (minor === 2 && patch < 2))
  // Within 0.2.2 only the alpha and beta lines and rc.1 still publish the field.
  const candidate = match[4] === undefined ? null : /^rc\.(\d+)$/.exec(match[4])
  return match[4] !== undefined && (candidate === null || Number(candidate[1]) < 2)
}

let contractContext: Context | undefined
let reportsParentAvailability: boolean | undefined

/**
 * Tell the pure conversation helpers which Host they run under. Called once when the client plugin
 * starts; a second call replaces the first, and `undefined` forgets it.
 * @param ctx - the client plugin's context, or undefined to return to the pre-0.2.2-rc.2 reading.
 */
export function bindHostContract(ctx: Context | undefined): void {
  contractContext = ctx
  reportsParentAvailability = undefined
}

/**
 * A continuable subagent's parent availability as the conversation should read it: the Host's
 * value where the Host reports one, and `true` on a Host that no longer tracks it. Without a
 * bound context, or before the Host has published its release, the older reading applies.
 * @param subagent - the Session snapshot's subagent record.
 * @returns undefined while an older Host is still resolving the parent, otherwise whether input may reach the child.
 */
export function parentAvailability(subagent: { readonly parentAvailable?: boolean }): boolean | undefined {
  if (reportsParentAvailability === undefined && contractContext !== undefined) {
    const version = hostReleaseVersion(contractContext)
    // Not cached until the release is known, so an early read cannot pin the older reading.
    if (version !== undefined) reportsParentAvailability = hostReportsParentAvailability(version)
  }
  return reportsParentAvailability === false ? true : subagent.parentAvailable
}

/** The official plugin that owns browser file-drag transfers from the 0.2.2 prereleases on. */
const OFFICIAL_FILE_DRAG = '@deepseek-ai/dsh-client-ui-file-drag'

/**
 * Whether the running Host composes the official file-drag plugin. That plugin then owns the
 * public `fileDrag` service, the `fileDrag` dictionaries and the feedback overlay; 0.2.1
 * releases ship none, and Modern UI provides them itself there.
 * @param ctx - any client context under the Host Loader.
 * @returns true when the Host's boot graph lists the official plugin.
 */
export function hostComposesFileDrag(ctx: Context): boolean {
  return ctx.get('modules')?.manifest.plugins.some(row => row.id === OFFICIAL_FILE_DRAG) === true
}

type AttachmentRead = ReturnType<ISession['readAttachment']>

/**
 * Read one durable image through the Session with the argument shape its Host expects.
 * @param session - Session object of the image's authorization scope.
 * @param protocol - protocol resolved for the running Host.
 * @param attachment - complete durable image reference.
 * @returns the Host's read result, unchanged.
 */
export function readImageAttachment(
  session: Pick<ISession, 'readAttachment'>,
  protocol: AttachmentReadProtocol,
  attachment: ImageAttachmentRef,
): AttachmentRead {
  // The installed typings describe one release; the call shape is selected at runtime.
  const read = session.readAttachment as unknown as (argument: ImageAttachmentRef | ImageAttachmentRef['attachmentId']) => AttachmentRead
  return read.call(session, protocol === 'attachment-ref' ? attachment : attachment.attachmentId)
}
