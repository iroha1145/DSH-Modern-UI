const PATH_CHARACTERS = /^[MmLlHhVvCcSsQqTtAaZz\d\s,.eE+-]*$/
const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }
const MAX_SVG_NUMBER = 3.4028234663852886e38
const whitespace = (character: string) => /[\t\n\f\r ]/.test(character)

/** Keep complete SVG segments, stopping at the first error (SVG 2 §9.5.4).
 * Streaming strings may end inside a parameter; never invent its missing values.
 * The original character/length limits still apply before parsing anything.
 */
export function completeSvgPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length >= 20000 || !PATH_CHARACTERS.test(value)) return undefined
  // Sticky matching avoids searching ahead or copying the remaining input on each number.
  const number = /[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/y
  let position = 0
  let complete = 0
  let command = ''
  const prefix = () => (complete ? value.slice(0, complete) : undefined)
  const skipWhitespace = () => {
    while (position < value.length && whitespace(value[position])) position++
  }

  while (position < value.length) {
    skipWhitespace()
    if (position === value.length) return value
    const next = value[position].toUpperCase()
    const explicit = Object.hasOwn(ARITY, next)
    if (explicit) {
      if (!complete && next !== 'M') return undefined
      command = next
      position++
      if (command === 'Z') {
        complete = position
        command = '' // Closepath cannot be implicitly repeated by numbers.
        continue
      }
    } else if (!command) {
      return prefix()
    }

    for (let parameter = 0; parameter < ARITY[command]; parameter++) {
      const separatorStart = position
      skipWhitespace()
      // A comma is allowed between parameters/implicit segments, never after a command.
      if ((!explicit || parameter > 0) && value[position] === ',') {
        position++
        skipWhitespace()
      }
      // Rotation and the first arc flag require a separator. Flags themselves
      // are single characters: 01.5 is flags 0,1 followed by coordinate .5.
      if (command === 'A' && parameter === 3 && position === separatorStart) return prefix()
      if (command === 'A' && (parameter === 3 || parameter === 4)) {
        if (value[position] !== '0' && value[position] !== '1') return prefix()
        position++
      } else {
        number.lastIndex = position
        const match = number.exec(value)
        // Bound the double before rounding: values just above float32's maximum
        // can round to a finite float yet fail Chromium/WebKit's SVG parser.
        // Conservatively omit these even if another browser accepts rounding.
        if (!match || Math.abs(Number(match[0])) > MAX_SVG_NUMBER) return prefix()
        position = number.lastIndex
        // Do not mistake the mantissa of an unfinished exponent for a complete parameter.
        if (value[position] === 'e' || value[position] === 'E') return prefix()
        // A trailing dot is not a complete SVG 2 number; browser support for
        // SVG 1.1's relaxed spelling differs. A second decimal (.5.6) is valid.
        if (value[position] === '.' && !/[0-9]/.test(value[position + 1] ?? '')) return prefix()
      }
    }
    complete = position
  }
  return value
}
