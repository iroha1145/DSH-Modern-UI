/**
 * Let asterisk strong emphasis open before punctuation and close after punctuation when CJK prose
 * continues without whitespace on the other side, e.g. `提出**“引力 = 熵力”**假说`.
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
    // which CommonMark's flanking rules refuse because the punctuation side is not whitespace.
    const cjkStrongOpen = markerCount >= 2
      && isCjkCharacter(previous)
      && unicodePunctuation(code)
    const cjkStrongClose = markerCount >= 2
      && unicodePunctuation(previous)
      && isCjkCharacter(code)
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
