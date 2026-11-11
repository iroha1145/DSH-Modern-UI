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
