/** Pure helpers for the chart component: number formats, tick precision, line curves and bar outlines. */

/** Formats a value; `compact` for axis ticks, `digits` for the decimals a tick step needs. */
export type Format = (value: number, compact?: boolean, digits?: number) => string;

export function makeFormat(kind: string | undefined, currency: string | undefined): Format {
  const code = typeof currency === "string" && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "USD";
  // Axis ticks are compact ("$2B") and carry as many decimals as their step needs ("0.0005"); tooltips keep at
  // least two decimals and the axis step's precision ("$1.24B", "1.0005"), or three significant digits below 1,
  // so a small non-zero value never reads as 0. Intl accepts at most 20 fraction digits.
  return (value, compact, digits) => {
    const big = Math.abs(value) >= (compact ? 1000 : 1e6);
    const tiny = (digits === undefined || !compact) && value !== 0 && Math.abs(value) < 1;
    const places = Math.min(20, compact ? (digits ?? 2) : Math.max(2, digits ?? 2));
    const fraction: Intl.NumberFormatOptions = tiny
      ? { maximumSignificantDigits: 3 }
      : { minimumFractionDigits: 0, maximumFractionDigits: big ? (compact ? 1 : 2) : places };
    if (kind === "percent") return `${value.toLocaleString("en-US", { ...fraction, useGrouping: false })}%`;
    const options: Intl.NumberFormatOptions = { ...fraction, ...(big ? { notation: "compact" } : {}) };
    return value.toLocaleString("en-US", kind === "currency" ? { ...options, style: "currency", currency: code } : options);
  };
}

/** Decimals that tell neighbouring ticks apart: 0 for a step of 1000, 1 for 2.5, 4 for 0.0005. */
export function stepDigits(step: number) {
  // Coincident ticks (a step lost to rounding) or a missing step need no decimals; Intl allows at most 20.
  if (!Number.isFinite(step) || step <= 0) return 0;
  const power = Math.floor(Math.log10(step));
  const lead = step / 10 ** power;
  return Math.min(20, Math.max(0, -power + (Math.abs(lead - Math.round(lead)) > 1e-9 ? 1 : 0)));
}

/** A path of straight segments through the points. */
export function polyline(points: readonly (readonly [number, number])[]) {
  return points.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
}

/** A path through the points that bends smoothly but never overshoots them (Steffen's monotone cubic). */
export function curve(points: readonly (readonly [number, number])[]) {
  const at = ([px, py]: readonly [number, number]) => `${px.toFixed(1)},${py.toFixed(1)}`;
  if (points.length < 3) return points.map((p, i) => `${i ? "L" : "M"}${at(p)}`).join("");
  const slope = (a: readonly [number, number], b: readonly [number, number]) => (b[1] - a[1]) / (b[0] - a[0] || 1);
  const secants = points.slice(1).map((p, i) => slope(points[i], p));
  const tangents = points.map((p, i) => {
    if (i === 0 || i === points.length - 1) return Number.NaN;
    const h0 = p[0] - points[i - 1][0];
    const h1 = points[i + 1][0] - p[0];
    const [s0, s1] = [secants[i - 1], secants[i]];
    const mid = (s0 * h1 + s1 * h0) / (h0 + h1 || 1);
    return (Math.sign(s0) + Math.sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(mid)) || 0;
  });
  const last = points.length - 1;
  // Ends lean on their neighbour's tangent, as a quadratic through the first or last three points would.
  tangents[0] = (3 * secants[0] - tangents[1]) / 2;
  tangents[last] = (3 * secants[last - 1] - tangents[last - 1]) / 2;
  let d = `M${at(points[0])}`;
  for (let i = 0; i < last; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const dx = (x1 - x0) / 3;
    d += `C${(x0 + dx).toFixed(1)},${(y0 + dx * tangents[i]).toFixed(1)} ${(x1 - dx).toFixed(1)},${(y1 - dx * tangents[i + 1]).toFixed(1)} ${at(points[i + 1])}`;
  }
  return d;
}

/** A bar whose two corners away from the baseline are rounded; the baseline side stays square. */
export function bar(left: number, top: number, width: number, height: number, up: boolean) {
  const r = Math.max(0, Math.min(8, width / 4, height));
  const right = left + width;
  const bottom = top + height;
  if (r === 0) return `M${left},${top}H${right}V${bottom}H${left}Z`;
  return up
    ? `M${left},${bottom}V${top + r}A${r},${r} 0 0 1 ${left + r},${top}H${right - r}A${r},${r} 0 0 1 ${right},${top + r}V${bottom}Z`
    : `M${left},${top}V${bottom - r}A${r},${r} 0 0 0 ${left + r},${bottom}H${right - r}A${r},${r} 0 0 0 ${right},${bottom - r}V${top}Z`;
}
