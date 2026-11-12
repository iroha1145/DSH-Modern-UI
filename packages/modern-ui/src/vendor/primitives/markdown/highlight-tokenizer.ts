import type { GrammarState, ThemedToken } from 'shiki/core'
import type { CSSProperties } from 'react'
import { engine } from './highlight-engine.ts'
import { grammarForHint, withinHighlightBudget, streamingFrameQuota, TOKENIZE_MAX_LINE_LENGTH, HIGHLIGHT_CHUNK_LINES } from './highlight-language.ts'
/**
 * Highlight `code` into shiki's HTML (a single `<pre class="shiki">` tree)
 * when `lang` maps to a registered grammar; `undefined` means the caller
 * renders its plain fallback. The worker registers grammars before use. Blocks
 * above the synchronous budget stay plain until the caller's async task completes.
 * @param code - the source text.
 * @param lang - the language hint (a markdown fence info string or a fixed caller id).
 * @returns the highlighted HTML, or `undefined` for unknown or not-yet-loaded languages.
 */
export function highlightToHtml(code: string, lang: string | undefined): string | undefined {
  const resolved = grammarForHint(lang)
  if (resolved === undefined) return undefined
  if (!withinHighlightBudget(code)) return undefined
  return engine.codeToHtml(code, {
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
  private prefixOffsets = [0]
  /** Grammar state after {@link prefix}; undefined = the grammar's initial state. */
  private state: GrammarState | undefined
  private lastCode: string | undefined
  private lastLang: string | undefined
  private lastResult: HighlightSpan[][] | undefined
  private generation = 0
  private lastFrame: StreamingHighlightFrame | undefined

  get prefixLength(): number { return this.prefix.length }
  get completedLineCount(): number { return this.spans.length }
  completedSince(index: number, end = this.spans.length): HighlightSpan[][] { return this.spans.slice(index, end) }
  prefixOffset(lines: number): number { return this.prefixOffsets[lines]! }

  private reset(resolved: string | undefined): void {
    this.resolved = resolved
    this.prefix = ''
    this.spans = []
    this.prefixOffsets = [0]
    this.state = undefined
    this.generation += 1
    this.lastFrame = undefined
  }

  /** Tokenize `text` with `resolved`, resuming from the cached grammar state when one exists. */
  private tokenize(resolved: string, text: string): ThemedToken[][] {
    return engine.codeToTokensBase(text, {
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
    if (resolved === undefined) {
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
      for (let index = 0; index < taken; index += 1) {
        if (rest[index] === '\n') this.prefixOffsets.push(this.prefix.length + index + 1)
      }
      this.state = engine.getLastGrammarState(tokens)
      this.prefix = code.slice(0, this.prefix.length + taken)
    }
    const pending = rest.slice(taken)
    // The growing last line is tokenized on its own whatever its length (the
    // per-line cap bounds it); a backlog of whole lines waits for its frame.
    const settled = !pending.includes('\n')
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
   * a React caller can reuse cached line elements. The worker registers the
   * requested grammar before calling this session.
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
  if (!withinHighlightBudget(code)) return undefined
  const { tokens } = engine.codeToTokens(code, {
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
  await new Promise<void>(resolve => setTimeout(resolve, 0))
}


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
  if (signal.aborted || resolved === undefined) return undefined

  const result: HighlightSpan[][] = []
  let state: GrammarState | undefined
  let deadline = performance.now() + 8
  let chunkStart = 0
  for (const line of code.split(/\r?\n/)) {
    if (signal.aborted) return undefined
    const tokens = engine.codeToTokensBase(line, {
      lang: resolved,
      theme: 'css-variables',
      tokenizeMaxLineLength: TOKENIZE_MAX_LINE_LENGTH,
      ...(state === undefined ? {} : { grammarState: state }),
    })
    state = engine.getLastGrammarState(tokens)
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
