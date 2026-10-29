/**
 * Let asterisk strong emphasis open before punctuation and close after punctuation when CJK prose
 * continues without whitespace on the other side, e.g. `提出**“引力 = 熵力”**假说`, and around
 * CJK punctuation when Latin letters or digits continue, e.g. `**研究对象：**DeepSeek`.
 */

import { attention } from 'micromark-core-commonmark'
import { unicodePunctuation } from 'micromark-util-character'
import { classifyCharacter } from 'micromark-util-classify-character'
import { codes, constants } from 'micromark-util-symbol'
import type { Construct, Extension, State, Tokenizer } from 'micromark-util-types'

const cjkCharacter = new RegExp([
  '\\p{Script_Extensions=Han}',
  '\\p{Script_Extensions=Hiragana}',
  '\\p{Script_Extensions=Katakana}',
  '\\p{Script_Extensions=Hangul}',
  '\\p{Script_Extensions=Bopomofo}',
].join('|'), 'u')

function isCjkCharacter(code: number | null): boolean {
  return code !== null && code >= 0 && cjkCharacter.test(String.fromCodePoint(code))
}

/**
 * CJK punctuation: CJK Symbols and Punctuation, fullwidth forms such as `：（），`, and the curly
 * quotes Chinese prose uses. English prose uses ASCII punctuation, so treating these as CJK
 * context leaves English emphasis on the CommonMark rules.
 */
function isCjkPunctuation(code: number | null): boolean {
  if (code === null || !unicodePunctuation(code)) return false
  return (code >= 0x3000 && code <= 0x303F) || (code >= 0xFF00 && code <= 0xFFEF)
    || code === 0x2018 || code === 0x2019 || code === 0x201C || code === 0x201D
}

const tokenizeCjkFriendlyAttention: Tokenizer = function (effects, ok, nok) {
  const configuredAttentionMarkers = this.parser.constructs.attentionMarkers.null
  if (configuredAttentionMarkers === undefined) {
    throw new Error('micromark CommonMark attention markers are unavailable')
  }
  const attentionMarkers = configuredAttentionMarkers
  const previous = this.previous
  const before = classifyCharacter(previous)
  let marker: number | null = codes.eof

  return start

  function start(code: number | null): State | undefined {
    /* v8 ignore next -- this text construct is dispatched only for an asterisk. */
    if (code !== codes.asterisk) return nok(code)
    marker = code
    effects.enter('attentionSequence')
    return inside(code)
  }

  function inside(code: number | null): State | undefined {
    if (code === marker) {
      effects.consume(code)
      return inside
    }

    const token = effects.exit('attentionSequence')
    const after = classifyCharacter(code)
    // Upstream micromark-core-commonmark: `*` and `_` are attention markers through core, but only
    // other registered markers may force a run to open or close.
    const commonMarkOpen = !after || (after === constants.characterGroupPunctuation && Boolean(before))
      || (attentionMarkers.includes(code) && code !== codes.asterisk && code !== codes.underscore)
    const commonMarkClose = !before
      || (before === constants.characterGroupPunctuation && Boolean(after))
      || (attentionMarkers.includes(previous) && previous !== codes.asterisk && previous !== codes.underscore)
    const markerCount = token.end.offset - token.start.offset
    // A `**` run between a CJK character and punctuation opens (CJK before) or closes (CJK after),
    // which CommonMark's flanking rules refuse because the punctuation side is not whitespace. The
    // same holds next to CJK punctuation when a letter or digit continues on the other side.
    const cjkStrongOpen = markerCount >= 2
      && unicodePunctuation(code)
      && (isCjkCharacter(previous) || (isCjkPunctuation(code) && !before))
    const cjkStrongClose = markerCount >= 2
      && unicodePunctuation(previous)
      && (isCjkCharacter(code) || (isCjkPunctuation(previous) && !after))
    const open = commonMarkOpen || cjkStrongOpen
    const close = commonMarkClose || cjkStrongClose

    token._open = open
    token._close = close
    return ok(code)
  }
}

const cjkFriendlyAttention: Construct = {
  name: 'cjkFriendlyAttention',
  resolveAll: attention.resolveAll,
  tokenize: tokenizeCjkFriendlyAttention,
}

const cjkFriendlyStrongExtension: Extension = {
  text: { [codes.asterisk]: cjkFriendlyAttention },
}

/**
 * Extend CommonMark asterisk strong emphasis for punctuation-delimited CJK
 * prose, as a micromark syntax extension for `fromMarkdown`.
 * @returns The micromark syntax extension.
 */
export function cjkFriendlyStrong(): Extension {
  return cjkFriendlyStrongExtension
}
