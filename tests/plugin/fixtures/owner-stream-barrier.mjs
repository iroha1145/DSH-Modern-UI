/** Hold a mock response until the test releases it and the real Host inbox is ready. */
export async function waitForOwnerStreamRelease({ signal, released, admitted, onAbort = () => {} }) {
  while (!released() || !admitted()) {
    if (signal?.aborted) {
      onAbort(signal.reason)
      signal.throwIfAborted()
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  signal?.throwIfAborted()
}

/** Match only the two actual test messages, rather than optimistic browser text. */
export function hasOwnerSteeringBatch(messages) {
  const texts = messages.flatMap(message => message.content ?? []).filter(block => block.type === 'text').map(block => block.text)
  return texts.includes('OWNER_STEER_FIRST') && texts.includes('OWNER_STEER_SECOND')
}
