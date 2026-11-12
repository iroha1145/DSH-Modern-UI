import { createCssVariablesTheme, createHighlighterCoreSync } from 'shiki/core'
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript'
import type { LanguageRegistration } from 'shiki'

const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const regexEngine = createJavaScriptRegexEngine({
  forgiving: true,
  regexConstructor: pattern => defaultJavaScriptRegexConstructor(pattern, { lazyCompileLength: Number.POSITIVE_INFINITY }),
})

// This module is materialized only by a visible code request, outside React's render.
export const engine = createHighlighterCoreSync({ themes: [theme], langs: [], engine: regexEngine })
const warmups = new Map([
  ['typescript', 'const answer: number = 42'],
  ['shellscript', 'printf \'%s\\n\' "$HOME"'],
  ['json', '{"ready":true}'],
])

export function registerGrammar(grammars: LanguageRegistration[], language: string): void {
  engine.loadLanguageSync(grammars)
  const code = warmups.get(language)
  if (code !== undefined) engine.codeToTokens(code, { lang: language, theme: 'css-variables', tokenizeTimeLimit: 0 })
}
