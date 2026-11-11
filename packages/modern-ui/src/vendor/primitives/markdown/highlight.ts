/**
 * The client's ONE syntax highlighter: a synchronous fine-grained shiki core
 * (JavaScript regex engine — no oniguruma WASM, bundle-friendly) with an
 * explicit grammar allowlist and a CSS-variables theme. Colors live in the
 * theme package's token sheets as `--shiki-*` custom properties (light and
 * dark blocks), never here — the repo's tokens-only styling rule.
 *
 * Only the three markdown-fence and `run_code` grammars (TypeScript, shell,
 * JSON) load into the singleton at boot — the set every session renders. Every
 * other language in the shared extension table
 * (`@deepseek-ai/dsh-util-code-language`: python, rust, yaml, markup, …) is
 * imported lazily and registered the first time such a language is requested,
 * so a session that never opens a code surface in one of those languages pays
 * neither the grammar modules nor their synchronous init. The first render of a
 * lazy language falls back to plain text while its grammar loads, then
 * {@link subscribeGrammarLoaded} notifies the language's subscribers.
 * An unknown or absent language falls back to plain text (no highlighting, still
 * monospace) — never an error.
 */

import { createHighlighterCoreSync, createCssVariablesTheme, splitLines } from 'shiki/core'
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'
import type { GrammarState, HighlighterCore, ThemedToken } from 'shiki/core'
import type { CSSProperties } from 'react'

/** A shiki grammar module's default export (a `LanguageRegistration[]`), taken
 *  from a boot grammar so no direct `@shikijs/types` dependency is needed. */
type LangModule = { default: typeof langTs }

/**
 * Grammars the singleton loads at boot; each entry's own `name` is the id
 * `codeToTokens`/`codeToHtml` resolve. The JS-family aliases (js/jsx/ts/tsx)
 * resolve to the TypeScript grammar rather than a separate one: it tokenizes
 * plain TS/JS exactly, and JSX/TSX approximately (shiki's TS grammar is not the
 * dedicated TSX grammar, so JSX elements tokenize imperfectly) — an accepted
 * trade to keep the boot set to one JS-family grammar. Every other language in
 * the shared extension table loads lazily through {@link LAZY_GRAMMARS}.
 */
const LANGS = [langTs, langBash, langJson]

/**
 * Replace the Go grammar's repeated one-line struct-field rule with the rule
 * worlpaker/go-syntax merged in 4a9b120a52c (https://github.com/worlpaker/go-syntax/pull/25):
 * the repeated rule backtracks exponentially on lines such as a brace-bearing
 * comment after `struct {`. Delete this patch once `@shikijs/langs` ships that
 * commit; 4.5.0 does not. The rule is located as the only rule in
 * `struct_variables_types_fields` containing the field-token literal below,
 * taken from `@shikijs/langs` 4.4.3.
 * @param grammars - the `@shikijs/langs/go` default export, left unmodified.
 * @returns copies of `grammars` with that rule's match replaced in the `go` grammar.
 * @throws When the module has no `go` grammar, the grammar lacks
 * `struct_variables_types_fields`, or that entry has no or several such rules.
 * The lazy load then rejects unhandled and Go code renders as plain text.
 */
export function patchGoGrammar(grammars: LangModule['default']): LangModule['default'] {
  const go = grammars.find(grammar => grammar.name === 'go')
  const fields = go?.repository.struct_variables_types_fields
  const patterns = fields?.patterns ?? []
  const rules = patterns.filter(rule => typeof rule.match === 'string' && rule.match.includes('[^"/`\\s]+;?'))
  if (go === undefined || fields === undefined || rules.length !== 1) {
    throw new Error(`ui-primitives: expected exactly one Go struct-field rule to patch for worlpaker/go-syntax#25, found ${
      rules.length}; update or delete the patch`)
  }
  const repository = { ...go.repository }
  repository.struct_variables_types_fields = {
    ...fields,
    patterns: patterns.map(rule => rule === rules[0]
      ? { ...rule, match: '(?:(?<=\\{)([^/\\`"]*[^\\s/\\`"])\\s*(?=\\}))' }
      : rule),
  }
  return grammars.map(grammar => grammar === go ? { ...go, repository } : grammar)
}

/**
 * The non-boot extension grammars, each behind a dynamic import so its module
 * stays out of the boot chunk until a code surface renders that language.
 * Keyed by the grammar id (`LanguageRegistration.name`) the aliases resolve to.
 * `@shikijs/langs`' default export is a `LanguageRegistration[]`; the loader
 * hands the whole array to `loadLanguageSync`, which registers each entry
 * (including embedded sub-grammars). The three boot grammars are absent —
 * already loaded, so no alias value ever points at a missing entry here.
 */
const LAZY_GRAMMARS = new Map<string, () => Promise<LangModule>>([
  ['python', () => import('@shikijs/langs/python')],
  ['ruby', () => import('@shikijs/langs/ruby')],
  ['go', async () => ({ default: patchGoGrammar((await import('@shikijs/langs/go')).default) })],
  ['rust', () => import('@shikijs/langs/rust')],
  ['java', () => import('@shikijs/langs/java')],
  ['c', () => import('@shikijs/langs/c')],
  ['cpp', () => import('@shikijs/langs/cpp')],
  ['csharp', () => import('@shikijs/langs/csharp')],
  ['kotlin', () => import('@shikijs/langs/kotlin')],
  ['swift', () => import('@shikijs/langs/swift')],
  ['php', () => import('@shikijs/langs/php')],
  ['yaml', () => import('@shikijs/langs/yaml')],
  ['toml', () => import('@shikijs/langs/toml')],
  ['ini', () => import('@shikijs/langs/ini')],
  ['markdown', () => import('@shikijs/langs/markdown')],
  ['mdx', () => import('@shikijs/langs/mdx')],
  ['html', () => import('@shikijs/langs/html')],
  ['css', () => import('@shikijs/langs/css')],
  ['scss', () => import('@shikijs/langs/scss')],
  ['less', () => import('@shikijs/langs/less')],
  ['sql', () => import('@shikijs/langs/sql')],
  ['xml', () => import('@shikijs/langs/xml')],
  ['lua', () => import('@shikijs/langs/lua')],
  ['bat', () => import('@shikijs/langs/bat')],
  ['powershell', () => import('@shikijs/langs/powershell')],
  ['fish', () => import('@shikijs/langs/fish')],
  ['dotenv', () => import('@shikijs/langs/dotenv')],
  ['log', () => import('@shikijs/langs/log')],
  ['csv', () => import('@shikijs/langs/csv')],
  ['diff', () => import('@shikijs/langs/diff')],
  ['http', () => import('@shikijs/langs/http')],
  ['rst', () => import('@shikijs/langs/rst')],
  ['latex', () => import('@shikijs/langs/latex')],
  ['bibtex', () => import('@shikijs/langs/bibtex')],
  ['asciidoc', () => import('@shikijs/langs/asciidoc')],
  ['r', () => import('@shikijs/langs/r')],
  ['julia', () => import('@shikijs/langs/julia')],
  ['dart', () => import('@shikijs/langs/dart')],
  ['scala', () => import('@shikijs/langs/scala')],
  ['clojure', () => import('@shikijs/langs/clojure')],
  ['erlang', () => import('@shikijs/langs/erlang')],
  ['elixir', () => import('@shikijs/langs/elixir')],
  ['haskell', () => import('@shikijs/langs/haskell')],
  ['fsharp', () => import('@shikijs/langs/fsharp')],
  ['vb', () => import('@shikijs/langs/vb')],
  ['perl', () => import('@shikijs/langs/perl')],
  ['verilog', () => import('@shikijs/langs/verilog')],
  ['system-verilog', () => import('@shikijs/langs/system-verilog')],
  ['graphql', () => import('@shikijs/langs/graphql')],
  ['proto', () => import('@shikijs/langs/proto')],
  ['hcl', () => import('@shikijs/langs/hcl')],
  ['nix', () => import('@shikijs/langs/nix')],
  ['vue', () => import('@shikijs/langs/vue')],
  ['svelte', () => import('@shikijs/langs/svelte')],
  ['make', () => import('@shikijs/langs/make')],
  ['cmake', () => import('@shikijs/langs/cmake')],
  ['groovy', () => import('@shikijs/langs/groovy')],
])

/**
 * Language ids (and aliases) the highlighter accepts; everything else renders
 * plain. A Map, not an object: fence info strings are assistant-authored, so
 * a label like `constructor` or `__proto__` must miss instead of resolving an
 * inherited property and crashing the renderer inside shiki. Keys cover both
 * the markdown-fence aliases `CodeBlock` uses, the file-extension language ids
 * `@deepseek-ai/dsh-util-code-language` resolves, and the short ids
 * `readLangHintForPath` persists, so every caller resolves the same grammars.
 * A new short name in the shared table must be aliased here too. The JS family maps to the TypeScript grammar (see {@link LANGS} for
 * the JSX/TSX approximation). A value not in {@link LANGS} names a
 * {@link LAZY_GRAMMARS} entry loaded on first use.
 */
const LANG_ALIASES = new Map<string, string>([
  ['typescript', 'typescript'],
  ['ts', 'typescript'],
  ['tsx', 'typescript'],
  ['javascript', 'typescript'],
  ['js', 'typescript'],
  ['jsx', 'typescript'],
  ['shellscript', 'shellscript'],
  ['bash', 'shellscript'],
  ['sh', 'shellscript'],
  ['shell', 'shellscript'],
  ['zsh', 'shellscript'],
  ['json', 'json'],
  ['jsonc', 'json'],
  ['py', 'python'],
  ['python', 'python'],
  ['rb', 'ruby'],
  ['ruby', 'ruby'],
  ['go', 'go'],
  ['rs', 'rust'],
  ['rust', 'rust'],
  ['java', 'java'],
  ['c', 'c'],
  ['cpp', 'cpp'],
  ['cs', 'csharp'],
  ['csharp', 'csharp'],
  ['kotlin', 'kotlin'],
  ['swift', 'swift'],
  ['php', 'php'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
  ['toml', 'toml'],
  ['ini', 'ini'],
  ['md', 'markdown'],
  ['markdown', 'markdown'],
  ['mdx', 'mdx'],
  ['html', 'html'],
  ['css', 'css'],
  ['scss', 'scss'],
  ['less', 'less'],
  ['sql', 'sql'],
  ['xml', 'xml'],
  ['lua', 'lua'],
  ['bat', 'bat'],
  ['batch', 'bat'],
  ['powershell', 'powershell'],
  ['ps1', 'powershell'],
  ['ps', 'powershell'],
  ['fish', 'fish'],
  ['properties', 'ini'],
  ['dotenv', 'dotenv'],
  ['env', 'dotenv'],
  ['log', 'log'],
  ['csv', 'csv'],
  ['diff', 'diff'],
  ['patch', 'diff'],
  ['http', 'http'],
  ['rst', 'rst'],
  ['latex', 'latex'],
  ['tex', 'latex'],
  ['bibtex', 'bibtex'],
  ['bib', 'bibtex'],
  ['asciidoc', 'asciidoc'],
  ['adoc', 'asciidoc'],
  ['r', 'r'],
  ['julia', 'julia'],
  ['jl', 'julia'],
  ['dart', 'dart'],
  ['scala', 'scala'],
  ['clojure', 'clojure'],
  ['clj', 'clojure'],
  ['erlang', 'erlang'],
  ['erl', 'erlang'],
  ['elixir', 'elixir'],
  ['ex', 'elixir'],
  ['exs', 'elixir'],
  ['haskell', 'haskell'],
  ['hs', 'haskell'],
  ['fsharp', 'fsharp'],
  ['fs', 'fsharp'],
  ['fsi', 'fsharp'],
  ['fsx', 'fsharp'],
  ['vb', 'vb'],
  ['vbnet', 'vb'],
  ['perl', 'perl'],
  ['pl', 'perl'],
  ['pm', 'perl'],
  ['verilog', 'verilog'],
  // Shiki's own `v` grammar is the V language; the fence label and the `.v`
  // extension both name Verilog here, so a future V registration needs a
  // different alias.
  ['v', 'verilog'],
  ['system-verilog', 'system-verilog'],
  ['systemverilog', 'system-verilog'],
  ['sv', 'system-verilog'],
  ['svh', 'system-verilog'],
  ['graphql', 'graphql'],
  ['gql', 'graphql'],
  ['proto', 'proto'],
  ['protobuf', 'proto'],
  ['hcl', 'hcl'],
  ['tf', 'hcl'],
  ['tfvars', 'hcl'],
  ['nix', 'nix'],
  ['vue', 'vue'],
  ['svelte', 'svelte'],
  ['make', 'make'],
  ['makefile', 'make'],
  ['mk', 'make'],
  ['cmake', 'cmake'],
  ['groovy', 'groovy'],
  ['gradle', 'groovy'],
])

/**
 * Resolve a language hint to the grammar id {@link LANG_ALIASES} selects.
 * @param lang - Language hint from a code surface: a canonical grammar id or the read card's persisted short id.
 * @returns The resolved grammar id, or `undefined` when the table aliases no grammar.
 */
export function grammarForHint(lang: string | undefined): string | undefined {
  return lang === undefined ? undefined : LANG_ALIASES.get(lang.toLowerCase())
}

/**
 * Whether a language hint can use the shared syntax highlighter.
 * @param lang - Language hint from a code surface.
 * @returns Whether the hint resolves to a supported grammar.
 */
export function supportsHighlighting(lang: string | undefined): boolean {
  return grammarForHint(lang) !== undefined
}

/** All token colors resolve through `--shiki-*` custom properties (theme package sheets). */
const cssVariablesTheme = createCssVariablesTheme({
  name: 'css-variables',
  variablePrefix: '--shiki-',
  fontStyle: true,
})

/**
 * The client regex engine compiles each TextMate pattern when its scanner is
 * created. Shiki otherwise defers patterns longer than 3,000 characters until
 * their first match; that compilation counts against Shiki's 500 ms per-line
 * budget and can return a partial token stream under host contention. Eager
 * compilation leaves the same budget in place for scanning user content.
 */
const regexEngine = createJavaScriptRegexEngine({
  forgiving: true,
  regexConstructor: pattern => defaultJavaScriptRegexConstructor(pattern, {
    lazyCompileLength: Number.POSITIVE_INFINITY,
  }),
})

/**
 * Long lines render as one uncolored token. The regex engine cannot yield
 * within a match, so even the asynchronous path needs a per-line cap. A skipped
 * line leaves the grammar state unchanged: a multi-line construct that opens
 * or closes on it colors the following lines as if the line were absent.
 */
const TOKENIZE_MAX_LINE_LENGTH = 500

const SYNC_MAX_CHARACTERS = 4096
const SYNC_MAX_LINES = 80
const SYNC_MAX_WORK = 120_000

/** Bound synchronous work by size, line count and the quadratic cost of long string lines. */
export function withinHighlightBudget(code: string): boolean {
  if (code.length > SYNC_MAX_CHARACTERS) return false
  const lines = splitLines(code)
  if (lines.length > SYNC_MAX_LINES) return false
  let work = 0
  for (const [line] of lines) {
    if (line.length < TOKENIZE_MAX_LINE_LENGTH) work += line.length * line.length
    if (work > SYNC_MAX_WORK) return false
  }
  return true
}

/**
 * How much of `completed` (whole lines, each ending in a newline) one streaming
 * frame may tokenize under the same budget. The first line always counts: a
 * single line is the unit of work, already capped by the per-line length limit.
 * @returns the length of the leading whole lines to take, newline included.
 */
function streamingFrameQuota(completed: string): number {
  let end = 0
  let lines = 0
  let work = 0
  while (end < completed.length) {
    const newline = completed.indexOf('\n', end)
    if (newline < 0) break
    const length = newline - end
    const cost = length < TOKENIZE_MAX_LINE_LENGTH ? length * length : 0
    if (lines > 0 && (newline + 1 > SYNC_MAX_CHARACTERS || lines + 1 > SYNC_MAX_LINES || work + cost > SYNC_MAX_WORK)) break
    work += cost
    lines += 1
    end = newline + 1
  }
  return end
}

let singleton: HighlighterCore | undefined

/** Representative paths through every boot grammar, compiled before user content is timed. */
const BOOT_GRAMMAR_WARMUPS = [
  { lang: 'typescript', code: 'const answer: number = 42' },
  { lang: 'shellscript', code: 'printf \'%s\\n\' "$HOME"' },
  { lang: 'json', code: '{"ready":true}' },
] as const

/** Construct and pre-tokenize the boot grammars outside the user-content scan budget. */
function createHighlighter(): HighlighterCore {
  const instance = createHighlighterCoreSync({
    themes: [cssVariablesTheme],
    langs: LANGS,
    engine: regexEngine,
  })
  for (const sample of BOOT_GRAMMAR_WARMUPS) {
    instance.codeToTokens(sample.code, {
      lang: sample.lang,
      theme: 'css-variables',
      tokenizeTimeLimit: 0,
    })
  }
  return instance
}

/** The synchronous highlighter (one instance per document); pre-warmed below, lazy as the fallback. */
function highlighter(): HighlighterCore {
  singleton ??= createHighlighter()
  return singleton
}

/** Grammar ids whose lazy import is in flight or done, so it is requested once. */
const requested = new Set<string>()
const listeners = new Map<string, Set<() => void>>()
const loadedGrammars = new Set<string>()

/** Subscribe only to the normalized language used by this code surface. */
export function subscribeGrammarLoaded(lang: string | undefined, listener: () => void): () => void {
  const resolved = grammarForHint(lang)
  if (resolved === undefined || !LAZY_GRAMMARS.has(resolved)) return () => {}
  let subscribers = listeners.get(resolved)
  if (subscribers === undefined) listeners.set(resolved, subscribers = new Set())
  subscribers.add(listener)
  return () => {
    subscribers.delete(listener)
    if (subscribers.size === 0) listeners.delete(resolved)
  }
}

/** Stable readiness snapshot: loading Python never invalidates TypeScript. */
export function isGrammarLoaded(lang: string | undefined): boolean {
  const resolved = grammarForHint(lang)
  return resolved !== undefined && (!LAZY_GRAMMARS.has(resolved) || loadedGrammars.has(resolved))
}

/**
 * Ensure the grammar `resolved` names is registered. A boot grammar (not in
 * {@link LAZY_GRAMMARS}) and an already-loaded lazy grammar report ready
 * synchronously; a lazy grammar not yet loaded starts its import (once) and
 * reports not-ready, so the caller renders plain until a
 * {@link subscribeGrammarLoaded} listener fires.
 * @param resolved - the grammar id an alias resolved to.
 * @returns whether the grammar is registered and ready to tokenize now.
 */
function ensureGrammar(resolved: string): boolean {
  const load = LAZY_GRAMMARS.get(resolved)
  // A boot grammar (already registered) has no lazy loader; it is always ready.
  if (load === undefined) return true
  if (highlighter().getLoadedLanguages().includes(resolved)) return true
  if (!requested.has(resolved)) {
    requested.add(resolved)
    void load().then((mod) => {
      highlighter().loadLanguageSync(mod.default)
      // A grammar module may also register embedded languages.
      for (const id of highlighter().getLoadedLanguages()) {
        if (loadedGrammars.has(id)) continue
        loadedGrammars.add(id)
        for (const listener of listeners.get(id) ?? []) listener()
      }
    }).catch(() => {
      // The fence stays plain; forget the request so a later render can import the grammar again.
      requested.delete(resolved)
    })
  }
  return false
}

// Engine + grammar construction costs a long task (~120-175ms); building it
// during the first finalized fence's render would jank exactly when a stream
// completes. Warm the singleton in a deferred task at module load (= plugin
// boot) instead; the lazy path above stays as the correctness fallback for a
// fence that renders before the timer fires. `unref` (Node-only) keeps a
// non-browser import from pinning the event loop.
const warmupTimer = setTimeout(() => { highlighter() }, 0)
;(warmupTimer as { unref?: () => void }).unref?.()

/**
 * Highlight `code` into shiki's HTML (a single `<pre class="shiki">` tree)
 * when `lang` maps to a registered grammar; `undefined` means the caller
 * renders its plain fallback. A lazy grammar not yet loaded returns `undefined`
 * for this call and loads in the background; subscribe with
 * {@link subscribeGrammarLoaded} to re-highlight once it registers. Blocks
 * above the synchronous budget stay plain until the caller's async task completes.
 * @param code - the source text.
 * @param lang - the language hint (a markdown fence info string or a fixed caller id).
 * @returns the highlighted HTML, or `undefined` for unknown or not-yet-loaded languages.
 */
export function highlightToHtml(code: string, lang: string | undefined): string | undefined {
  const resolved = grammarForHint(lang)
  if (resolved === undefined) return undefined
  if (!ensureGrammar(resolved)) return undefined
  if (!withinHighlightBudget(code)) return undefined
  return highlighter().codeToHtml(code, {
    lang: resolved, theme: 'css-variables', tokenizeMaxLineLength: TOKENIZE_MAX_LINE_LENGTH,
  })
}

/**
 * One highlighted run of a line: the text and the inline style shiki assigned
 * it. The css-variables theme colors every run through a `--shiki-*` custom
 * property, so `style.color` is always present; it is held as a style object
 * rather than a bare color so a run spreads onto a `<span style>` uniformly.
 */
export interface HighlightSpan {
  text: string
  style: CSSProperties
}

/** vscode-textmate FontStyle bits shiki folds into `text-decoration` values. */
const DECORATION_BITS: readonly (readonly [number, string])[] = [[4, 'underline'], [8, 'line-through']]

/**
 * The inline style shiki's HTML arm assigns one token (`getTokenStyleObject`
 * mirrored onto React style keys): the css-variables color plus the
 * vscode-textmate font-style bits the theme lets through — italic (1), bold
 * (2), and the {@link DECORATION_BITS} decorations (the theme injects bold,
 * italic, and underline rules for markup scopes, so markdown fences carry
 * them). The theme has no per-scope backgrounds, so `background-color` never
 * occurs; the arm-parity tests fail loud if a shiki upgrade changes that.
 */
function spanStyle(token: ThemedToken): CSSProperties {
  const style: CSSProperties = { color: token.color }
  /* v8 ignore next -- fontStyle is optional in ThemedToken's type; tokenizeWithTheme always stamps it. */
  const bits = token.fontStyle ?? 0
  if ((bits & 1) !== 0) style.fontStyle = 'italic'
  if ((bits & 2) !== 0) style.fontWeight = 'bold'
  const decorations = DECORATION_BITS.filter(([bit]) => (bits & bit) !== 0)
  if (decorations.length > 0) style.textDecoration = decorations.map(([, value]) => value).join(' ')
  return style
}

/**
 * Narrow one tokenized line to the runs a `<span style>` renders, folding a
 * whitespace-only run into the token that follows it — shiki's default
 * `mergeWhitespaces` HTML behavior — with each run styled through
 * {@link spanStyle}, so the streaming spans and the settled `codeToHtml`
 * swap render one identical span tree. shiki exempts underlined/struck
 * whitespace from the fold; under the css-variables theme that case cannot
 * occur — its only underline rule styles inline-link scopes, whose spaced
 * text tokenizes as one run, and it injects no strikethrough rule — so the
 * unconditional fold here stays equivalent (the markdown arm-parity test
 * pins it). A line-trailing whitespace-only run has no follower and keeps
 * its own span, as in shiki.
 */
function lineSpans(line: ThemedToken[]): HighlightSpan[] {
  const spans: HighlightSpan[] = []
  let pendingWhitespace = ''
  for (const [index, token] of line.entries()) {
    if (/^\s+$/.test(token.content) && index + 1 < line.length) {
      pendingWhitespace += token.content
      continue
    }
    spans.push({ text: pendingWhitespace + token.content, style: spanStyle(token) })
    pendingWhitespace = ''
  }
  return spans
}

/**
 * Incremental highlighter for one growing streaming fence. TextMate
 * tokenization is line-based and forward-only — a line's tokens depend only on
 * its own text and the grammar state entering it — so appended text never
 * changes a completed line's tokens. The session caches the spans of every
 * completed line together with the grammar state after them;
 * {@link updateFrame} reports only newly completed lines plus the still-growing
 * last line, while {@link update} materializes the complete compatibility
 * result. Per-call tokenization cost therefore excludes the completed prefix
 * and is bounded by the synchronous budget: lines beyond one frame's share stay
 * plain until a later frame reaches them. Once a frame reports `settled`, the
 * result equals a from-scratch tokenization of the same code.
 * Non-append input and a change of resolved grammar reset the cache and
 * re-tokenize fully, so any input stays correct.
 */
export class StreamingHighlightSession {
  /** Grammar id the cache was built with; a different resolution resets it. */
  private resolved: string | undefined
  /** Newline-terminated source prefix covered by {@link spans}. */
  private prefix = ''
  /** Cached spans, one entry per completed line of {@link prefix}. */
  private spans: HighlightSpan[][] = []
  /** Grammar state after {@link prefix}; undefined = the grammar's initial state. */
  private state: GrammarState | undefined
  private lastCode: string | undefined
  private lastLang: string | undefined
  private lastResult: HighlightSpan[][] | undefined
  private generation = 0
  private lastFrame: StreamingHighlightFrame | undefined

  private reset(resolved: string | undefined): void {
    this.resolved = resolved
    this.prefix = ''
    this.spans = []
    this.state = undefined
    this.generation += 1
    this.lastFrame = undefined
  }

  /** Tokenize `text` with `resolved`, resuming from the cached grammar state when one exists. */
  private tokenize(resolved: string, text: string): ThemedToken[][] {
    return highlighter().codeToTokensBase(text, {
      lang: resolved,
      theme: 'css-variables',
      tokenizeMaxLineLength: TOKENIZE_MAX_LINE_LENGTH,
      ...(this.state === undefined ? {} : { grammarState: this.state }),
    })
  }

  /**
   * Tokenize one update as a delta for a retained renderer.
   * @param code - the fence text accumulated so far.
   * @param lang - the language hint.
   * @returns Newly completed lines plus the current tail, or `undefined` for the plain arm.
   */
  updateFrame(code: string, lang: string | undefined): StreamingHighlightFrame | undefined {
    if (code === this.lastCode && lang === this.lastLang && this.lastFrame !== undefined) {
      return this.lastFrame
    }
    this.lastCode = code
    this.lastLang = lang
    this.lastResult = undefined
    const resolved = grammarForHint(lang)
    if (resolved === undefined || !ensureGrammar(resolved)) {
      this.reset(undefined)
      return undefined
    }
    if (resolved !== this.resolved || !code.startsWith(this.prefix)) this.reset(resolved)
    const firstNewLine = this.spans.length
    const rest = code.slice(this.prefix.length)
    // One frame tokenizes at most one budget of newly completed lines. Text that
    // arrives faster than that, or a fence first seen when it is already long,
    // keeps its colored prefix: the backlog shows as plain lines and the
    // following frames work through it.
    const taken = streamingFrameQuota(rest.slice(0, rest.lastIndexOf('\n') + 1))
    if (taken > 0) {
      const grownEnd = rest[taken - 2] === '\r' ? taken - 2 : taken - 1
      const tokens = this.tokenize(resolved, rest.slice(0, grownEnd))
      for (const line of tokens) this.spans.push(lineSpans(line))
      this.state = highlighter().getLastGrammarState(tokens)
      this.prefix = code.slice(0, this.prefix.length + taken)
    }
    const pending = rest.slice(taken)
    // The growing last line is tokenized on its own whatever its length (the
    // per-line cap bounds it); a backlog of whole lines waits for its frame.
    const settled = !pending.includes('\n') || withinHighlightBudget(pending)
    this.lastFrame = {
      generation: this.generation,
      appended: this.spans.slice(firstNewLine),
      tail: settled
        ? this.tokenize(resolved, pending).map(lineSpans)
        : pending.split(/\r?\n/).map(line => [{ text: line, style: {} }]),
      settled,
    }
    return this.lastFrame
  }

  /**
   * Tokenize the fence's current text into per-line highlighted runs;
   * `undefined` means the caller renders its plain fallback. Idempotent per
   * (`code`, `lang`) input — repeated calls return the identical result array —
   * and a retained line keeps its span-array identity across growing calls, so
   * a React caller can reuse cached line elements. A lazy grammar not yet
   * loaded returns `undefined` and loads in the background exactly as
   * {@link highlightToHtml} does; the next call after it registers highlights.
   * @param code - the fence text accumulated so far (display-trimmed, no synthetic trailing newline).
   * @param lang - the language hint (a markdown fence info string).
   * @returns one entry per line of `code` (each an array of runs), or `undefined` for unknown or not-yet-loaded languages.
   */
  update(code: string, lang: string | undefined): readonly HighlightSpan[][] | undefined {
    if (code === this.lastCode && lang === this.lastLang && this.lastResult !== undefined) {
      return this.lastResult
    }
    const frame = this.updateFrame(code, lang)
    if (frame === undefined) return undefined
    this.lastResult = [...this.spans, ...frame.tail]
    return this.lastResult
  }
}

/** One retained-renderer update from {@link StreamingHighlightSession.updateFrame}. */
export interface StreamingHighlightFrame {
  /** Changes whenever prior completed lines must be discarded. */
  readonly generation: number
  /** Completed lines added since the preceding frame in this generation. */
  readonly appended: readonly HighlightSpan[][]
  /** The still-growing final line or lines, replaced by the next frame. */
  readonly tail: readonly HighlightSpan[][]
  /** False while {@link tail} still holds untokenized backlog lines shown as plain text. */
  readonly settled: boolean
}

/**
 * Tokenize `code` into per-line highlighted runs when `lang` maps to a
 * registered grammar; `undefined` means the caller renders its plain fallback.
 * A line-numbered view needs the token runs split per line (one gutter number
 * per line), which the single-`<pre>` {@link highlightToHtml} does not expose,
 * so this returns shiki's own 2D line/token structure narrowed to what a run
 * renders. Each run's color is a `--shiki-*` custom property, keeping token
 * colors on the theme package's sheets exactly as the HTML path does; the
 * markup font-style bits the theme lets through (bold/italic/underline in
 * markdown scopes) are dropped — the line-numbered file view renders
 * color-only runs. The trailing newline shiki appends as a final empty line
 * is dropped so the run count matches the caller's own line array.
 * @param code - the source text.
 * @param lang - the language hint (a file-extension-derived language id).
 * @returns one entry per source line (each an array of runs), or `undefined` for unknown or not-yet-loaded languages.
 */
export function highlightLines(code: string, lang: string | undefined): HighlightSpan[][] | undefined {
  const resolved = grammarForHint(lang)
  if (resolved === undefined) return undefined
  if (!ensureGrammar(resolved)) return undefined
  if (!withinHighlightBudget(code)) return undefined
  const { tokens } = highlighter().codeToTokens(code, {
    lang: resolved, theme: 'css-variables', tokenizeMaxLineLength: TOKENIZE_MAX_LINE_LENGTH,
  })
  // shiki tokenizes `a\nb` into two lines; a trailing newline (`a\n`) adds a
  // third, empty line the caller's own line array does not carry. Drop that
  // one terminator line so the two structures stay in step. The explicit
  // `last !== undefined` (over `tokens[...]?.length`) keeps a single branch for
  // per-file coverage, matching TerminalBlock's terminator check.
  const last = tokens[tokens.length - 1]
  const lines = tokens.length > 1 && last !== undefined && last.length === 0
    ? tokens.slice(0, -1)
    : tokens
  return lines.map(line => line.map(token => ({ text: token.content, style: { color: token.color } })))
}

async function yieldHighlighting(): Promise<void> {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (scheduler?.yield !== undefined) await scheduler.yield()
  else await new Promise<void>(resolve => setTimeout(resolve, 0))
}

/** Keep each DOM upgrade small as well as each tokenization slice. */
export const HIGHLIGHT_CHUNK_LINES = 32

/** Highlight a large block in cancellable slices, carrying TextMate state across every line. */
export async function highlightLinesAsync(
  code: string,
  lang: string | undefined,
  signal: AbortSignal,
  onChunk?: (lines: HighlightSpan[][]) => void,
): Promise<HighlightSpan[][] | undefined> {
  // Commit the readable plain fallback before starting any tokenization.
  await yieldHighlighting()
  const resolved = grammarForHint(lang)
  if (signal.aborted || resolved === undefined || !ensureGrammar(resolved)) return undefined
  const result: HighlightSpan[][] = []
  let state: GrammarState | undefined
  let deadline = performance.now() + 8
  let chunkStart = 0
  for (const [line] of splitLines(code)) {
    if (signal.aborted) return undefined
    const tokens = highlighter().codeToTokensBase(line, {
      lang: resolved,
      theme: 'css-variables',
      tokenizeMaxLineLength: TOKENIZE_MAX_LINE_LENGTH,
      ...(state === undefined ? {} : { grammarState: state }),
    })
    state = highlighter().getLastGrammarState(tokens)
    result.push(lineSpans(tokens[0]!))
    const chunkReady = result.length - chunkStart === HIGHLIGHT_CHUNK_LINES
    if (chunkReady) {
      onChunk?.(result.slice(chunkStart))
      chunkStart = result.length
    }
    if (performance.now() >= deadline || chunkReady) {
      await yieldHighlighting()
      if (signal.aborted) return undefined
      deadline = performance.now() + 8
    }
  }
  if (chunkStart < result.length) onChunk?.(result.slice(chunkStart))
  return result
}
