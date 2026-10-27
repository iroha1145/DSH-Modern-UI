/**
 * A price per million tokens, with four significant digits and no trailing
 * zeros. Scientific notation keeps every finite nonzero price visibly nonzero,
 * including values smaller than the browser's fixed-decimal precision.
 * @param value - US dollars per million tokens.
 * @returns the numeric amount shared by picker text, tooltips, and settings.
 */
export function formatPrice(value: number): string {
  return String(Number(value.toPrecision(4)))
}
