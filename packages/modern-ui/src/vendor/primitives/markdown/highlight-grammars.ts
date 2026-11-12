/** A shiki grammar module's default export (a `LanguageRegistration[]`), taken
 *  from a boot grammar so no direct `@shikijs/types` dependency is needed. */
type LangModule = { default: typeof import('@shikijs/langs/typescript').default }

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

/** Every supported grammar uses the official dynamic chunk transport, including the common fence languages. */
export const LAZY_GRAMMARS = new Map<string, () => Promise<LangModule>>([
  ['typescript', () => import('@shikijs/langs/typescript')],
  ['shellscript', () => import('@shikijs/langs/shellscript')],
  ['json', () => import('@shikijs/langs/json')],
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
