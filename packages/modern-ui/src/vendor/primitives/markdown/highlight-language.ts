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

/**
 * Long lines render as one uncolored token. The regex engine cannot yield
 * within a match, so even the asynchronous path needs a per-line cap. A skipped
 * line leaves the grammar state unchanged: a multi-line construct that opens
 * or closes on it colors the following lines as if the line were absent.
 */
export const TOKENIZE_MAX_LINE_LENGTH = 500

const SYNC_MAX_CHARACTERS = 4096
const SYNC_MAX_LINES = 80
const SYNC_MAX_WORK = 120_000

/** Bound synchronous work by size, line count and the quadratic cost of long string lines. */
export function withinHighlightBudget(code: string): boolean {
  if (code.length > SYNC_MAX_CHARACTERS) return false
  const lines = code.split(/\r?\n/)
  if (lines.length > SYNC_MAX_LINES) return false
  let work = 0
  for (const line of lines) {
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
export function streamingFrameQuota(completed: string): number {
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


/** Tokenization and DOM updates share this fixed maximum batch size. */
export const HIGHLIGHT_CHUNK_LINES = 32
