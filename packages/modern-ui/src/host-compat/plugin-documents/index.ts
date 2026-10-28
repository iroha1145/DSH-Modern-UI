/** Read plugin descriptions through authenticated, owner-only Connection routes. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveBundleDir } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import type {} from '@deepseek-ai/dsh-plugin-market'
import type {} from '@deepseek-ai/dsh-client-connection'
import { resolve } from 'node:path'
import { DetailReader, repositoryOf, type DetailLocation, type RepositoryLocation } from './detail.ts'
import { repositoryFiles, type RepositoryFileOptions } from './detail-files.ts'
import { RepositoryCache } from './repository-cache.ts'
import { DetailFailure, detailImageResponse, languageChain, localFiles, npmFiles, NPM_FILE_SOURCES, type NpmFileSource } from './detail/index.ts'
import type { PluginDetail } from './types.ts'

export const name = 'modern-plugin-documents'
export const inject = ['connection', 'pluginManager', 'profileContext']
export const DOCUMENT_PATH = '/api/modern-ui/plugin-document'
export const IMAGE_PATH = '/api/modern-ui/plugin-document-image'
const PUBLIC_REGISTRIES = new Set(['registry.npmjs.org', 'registry.npmmirror.com'])
const sourceFields = {
  maxDocumentBytes: z.natural().min(1), maxImageBytes: z.natural().min(1),
  fetchTimeoutMs: z.natural().min(1).max(2_147_483_647),
  npmFileSources: z.array(z.union(NPM_FILE_SOURCES)).min(1).default([...NPM_FILE_SOURCES]),
}

export const Config = z.object({
  maxDocumentBytes: z.natural().min(1).default(1024 * 1024),
  maxImageBytes: z.natural().min(1).default(5 * 1024 * 1024),
  fetchTimeoutMs: z.natural().min(1).max(2_147_483_647).default(15000),
  cacheTtlMs: z.natural().default(600000),
  bundle: z.object(sourceFields).default({}),
  market: z.object({ ...sourceFields,
    cacheTtlMs: z.natural(), gitlabHosts: z.array(z.string()).default(['gitlab.com']),
    maxRepositoryBytes: z.natural().min(1), maxCacheBytes: z.natural().min(1), cacheDir: z.string(),
    gitTimeoutMs: z.natural().min(1).max(2_147_483_647),
  }).default({}),
})
export interface SourceConfig {
  maxDocumentBytes?: number
  maxImageBytes?: number
  fetchTimeoutMs?: number
  npmFileSources?: NpmFileSource[]
}
export interface Config {
  maxDocumentBytes: number
  maxImageBytes: number
  fetchTimeoutMs: number
  cacheTtlMs: number
  bundle?: SourceConfig
  market?: SourceConfig & {
    cacheTtlMs?: number
    gitlabHosts?: string[]
    maxRepositoryBytes?: number
    maxCacheBytes?: number
    cacheDir?: string
    gitTimeoutMs?: number
  }
}

function parameter(params: URLSearchParams, name: string): string {
  const value = params.get(name)
  if (value === null || value.length === 0 || value.length > 4096) throw new DetailFailure('invalid', `Missing or invalid ${name}`)
  return value
}

const STATUS = { 'too-large': 413, network: 502, denied: 403, 'git-unavailable': 503, invalid: 400 } as const

/** Own bounded reads and the image identities returned by those reads. */
export class PluginDocuments {
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly repositories: RepositoryCache
  private readonly repositoryOptions: RepositoryFileOptions
  private readonly readers: Record<'bundle' | 'market', DetailReader>
  private readonly sources: Record<'bundle' | 'market', Required<SourceConfig>>

  constructor(private readonly ctx: Context, config: Config) {
    const profile = ctx.profileContext
    const source = (overrides: SourceConfig = {}): Required<SourceConfig> => ({
      maxDocumentBytes: overrides.maxDocumentBytes ?? config.maxDocumentBytes,
      maxImageBytes: overrides.maxImageBytes ?? config.maxImageBytes,
      fetchTimeoutMs: overrides.fetchTimeoutMs ?? config.fetchTimeoutMs,
      npmFileSources: overrides.npmFileSources ?? [...NPM_FILE_SOURCES],
    })
    this.sources = { bundle: source(config.bundle), market: source(config.market) }
    const ttlMs = config.market?.cacheTtlMs ?? config.cacheTtlMs
    this.repositories = new RepositoryCache({
      dir: resolve(profile.dir, config.market?.cacheDir ?? '.modern-ui/plugin-documents'),
      maxRepositoryBytes: config.market?.maxRepositoryBytes ?? 50 * 1024 * 1024,
      maxCacheBytes: config.market?.maxCacheBytes ?? 500 * 1024 * 1024,
      timeoutMs: config.market?.gitTimeoutMs ?? 60000, ttlMs, transports: ['https', 'http', 'ssh'],
      lifetime: this.lifetime.signal, sizePollMs: 200,
    })
    this.repositoryOptions = { timeoutMs: this.sources.market.fetchTimeoutMs, lifetime: this.lifetime.signal,
      gitlabHosts: (config.market?.gitlabHosts ?? ['gitlab.com']).map(host => host.toLowerCase()), cache: this.repositories }
    this.readers = {
      bundle: new DetailReader({ ...this.sources.bundle, ttlMs: config.cacheTtlMs }, this.repositoryOptions, 'bundle:'),
      market: new DetailReader({ ...this.sources.market, ttlMs }, this.repositoryOptions, 'market:'),
    }
  }

  async dispose(): Promise<void> {
    this.lifetime.abort(new Error('Plugin document reader disposed'))
    await Promise.allSettled([...this.pending, this.repositories.settled()])
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation)
    void operation.then(() => this.pending.delete(operation), () => this.pending.delete(operation))
    return operation
  }

  /** Package names and market sources must already belong to the official inventory. */
  async read(params: URLSearchParams): Promise<PluginDetail> {
    this.lifetime.signal.throwIfAborted()
    const language = parameter(params, 'language')
    let languages: string[]
    try { languages = languageChain(language) }
    catch (error) { throw new DetailFailure('invalid', 'Invalid document language', { cause: error }) }
    const name = parameter(params, 'name')
    const kind = parameter(params, 'kind')
    let location: DetailLocation
    let local = false
    if (kind === 'bundle') {
      const bundle = (await this.ctx.pluginManager.listBundles()).find(item => item.name === name)
      if (bundle === undefined) throw new DetailFailure('invalid', 'Unknown plugin bundle')
      if (bundle.availability !== 'missing') {
        const profile = this.ctx.profileContext
        const directory = resolveBundleDir('dsh', bundle.name, profile.installAnchor, profile.dir)
        location = { files: localFiles(directory, String(bundle.version)), dir: '', repository: undefined }
        local = true
      } else if (bundle.installTarget?.version !== undefined) {
        location = this.npmLocation('bundle', bundle.name, bundle.installTarget.version, undefined)
      } else return { status: 'none' }
    } else if (kind === 'market') {
      const market = this.ctx.get('pluginMarket')
      if (market === undefined) throw new DetailFailure('invalid', 'Plugin market is unavailable')
      const plugin = await market.entry(parameter(params, 'url'), name)
      const version = parameter(params, 'version')
      const listed = plugin?.versions.find(item => item.version === version)
      if (plugin === undefined || listed === undefined) throw new DetailFailure('invalid', 'Unknown plugin market version')
      const declared = plugin.repository
      const found = declared === undefined ? undefined : repositoryOf(declared.url)
      let repository: RepositoryLocation | undefined = found === undefined ? undefined
        : { ...found, directory: declared?.directory ?? '' }
      const source = listed.source
      if (source.type === 'git') {
        const reference = repositoryOf(source.url)
        if (reference === undefined) throw new DetailFailure('invalid', 'Invalid plugin repository')
        const directory = source.path ?? ''
        if (repository?.url === reference.url && repository.directory === directory) repository = undefined
        location = { files: repositoryFiles(reference, source.commit, this.repositoryOptions), dir: directory, repository }
      } else if (source.registry === undefined || PUBLIC_REGISTRIES.has(new URL(source.registry).host)) {
        location = this.npmLocation('market', name, version, repository ?? 'manifest')
      } else location = { dir: '', repository }
    } else throw new DetailFailure('invalid', 'Unknown plugin document kind')
    this.lifetime.signal.throwIfAborted()
    // Installed/development bundle files have no immutable content revision.
    // Re-read them as the old manager did, retaining stable image identities.
    return this.readers[kind].read(location, languages, local || params.get('refresh') === 'true')
  }

  private npmLocation(kind: 'bundle' | 'market', name: string, version: string, repository: DetailLocation['repository']): DetailLocation {
    const source = this.sources[kind]
    return { files: npmFiles(name, version, source.npmFileSources,
      { timeoutMs: source.fetchTimeoutMs, lifetime: this.lifetime.signal }), dir: '', repository }
  }

  document(request: Request): Promise<Response> {
    return this.track(this.read(new URL(request.url).searchParams).then(value => Response.json(value,
      { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }), error => {
      if (error instanceof DetailFailure) return Response.json({ reason: error.reason }, { status: STATUS[error.reason], headers: { 'Cache-Control': 'no-store' } })
      throw error
    }))
  }

  image(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams
    const operation = Promise.resolve().then(() => {
      const id = parameter(params, 'document')
      const reader = id.startsWith('bundle:') ? this.readers.bundle : id.startsWith('market:') ? this.readers.market : undefined
      return reader?.image(id, parameter(params, 'path'))
    })
      .then(value => detailImageResponse(value, 'private, max-age=600'), error => {
        if (error instanceof DetailFailure) return detailImageResponse(error.reason, 'no-store')
        throw error
      })
    return this.track(operation)
  }
}

export function apply(ctx: Context, config: Config): void {
  const documents = new PluginDocuments(ctx, config)
  ctx.effect(() => () => documents.dispose())
  for (const [path, fetch] of [[DOCUMENT_PATH, documents.document.bind(documents)], [IMAGE_PATH, documents.image.bind(documents)]] as const) {
    ctx.effect(() => ctx.connection.fetch.register({ path, methods: ['GET'], requestBody: 'buffered', fetch }))
  }
}
