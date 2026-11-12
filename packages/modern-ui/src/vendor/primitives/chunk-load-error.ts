/** The official classic-script transport's explicit failure; execution errors retain their normal error boundary. */
export function isChunkLoadError(error: unknown): error is Error {
  return error instanceof Error && /^client-modules: bundle script .+ failed to load$/.test(error.message)
}
