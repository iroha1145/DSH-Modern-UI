/** Pure helpers for the chart component: number formats, tick precision, line curves, bar outlines and stacked areas. */

/** Formats a value; `compact` for axis ticks, `step` for the axis step whose precision the text keeps. */
export type Format = (value: number, compact?: boolean, step?: number) => string;

// The units en-US compact notation writes as T, B, M and K.
const UNITS = [1e12, 1e9, 1e6, 1e3];

export function makeFormat(kind: string | undefined, currency: string | undefined, locale = "en-US"): Format {
  const code = typeof currency === "string" && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "USD";
  const writer = (tag: string) => {
    const percentParts = new Intl.NumberFormat(tag, { style: "percent", useGrouping: false }).formatToParts(1);
    return (value: number, options: Intl.NumberFormatOptions) =>
      kind === "percent"
        ? percentParts.map(part => part.type === "integer" ? value.toLocaleString(tag, { ...options, useGrouping: false }) : part.value).join("")
        : value.toLocaleString(tag, kind === "currency" ? { ...options, style: "currency", currency: code } : options);
  };
  // Values written out in full follow the interface language. K, M, B and T are en-US compact notation, and the
  // precision rules below count in those units; other languages abbreviate by other powers (10^4 and 10^8 in Chinese),
  // so abbreviated values keep the en-US writer in every language. The ticks of one axis read as a series and are all
  // written by that one writer; without it a Chinese interface spelled every tick out ("US$1,500,000,000").
  const written = writer(locale);
  const abbreviated = writer("en-US");
  // Ticks a step apart always read differently: compact where the unit keeps the step's precision ("$2B", "1.25B"),
  // written out where it cannot ("1,000,000.2", "2,021"), with the decimals the step needs ("0.0005"), and past the
  // 20 fraction digits Intl accepts in scientific notation ("2E-26"). Tooltips show the value itself: at least two
  // decimals, the step's precision and three significant digits below 1 ("1.0005", "0.000123"), compact only where
  // that loses nothing ("$1.24B", but "1,000,001"), so a small non-zero value never reads as 0.
  return (value, compact, step = 0) => {
    const write = compact ? abbreviated : written;
    const abs = Math.abs(value);
    if (value === 0 || !Number.isFinite(value)) return write(value, { maximumFractionDigits: 0 });
    const places = compact ? stepDigits(step) : Math.max(2, stepDigits(step), abs < 1 ? 2 - Math.floor(Math.log10(abs)) : 0);
    if (places > 20 || abs >= 1e21) {
      const mantissa = stepDigits(step / (10 ** Math.floor(Math.log10(abs)) || Number.MIN_VALUE));
      return write(value, compact ? { notation: "scientific", maximumFractionDigits: Math.min(20, mantissa) } : { notation: "scientific", maximumSignificantDigits: 3 });
    }
    const unit = kind === "percent" ? undefined : UNITS.find((u) => abs >= u && (compact || u >= 1e6));
    // The unit keeps the step's precision in at most two decimals, so values on this axis read compact.
    const scaled = unit === undefined ? Number.POSITIVE_INFINITY : stepDigits(step / unit);
    if (unit !== undefined && scaled <= 2) {
      if (compact) return abbreviated(value, { notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: scaled });
      // Hundredths of the unit in the written-out value: a whole number of them reads the same compact.
      const hundredths = Number(value.toFixed(places)) / (unit / 100);
      if (Math.abs(hundredths - Math.round(hundredths)) < 1e-9 * Math.max(1, Math.abs(hundredths)))
        return abbreviated(value, { notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }
    return write(value, { minimumFractionDigits: 0, maximumFractionDigits: places });
  };
}

/** A value axis: lowest and highest tick and the step between ticks. */
export interface Domain {
  lo: number;
  hi: number;
  step: number;
}

/** Fixed bounds a chart asks for; the axis still widens to show values outside them. */
export interface Range {
  min?: number;
  max?: number;
}

/** A round step giving about span/step ticks: 1, 2, 2.5 or 5 times a power of ten. */
export function niceStep(span: number) {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const power = Math.max(Number.MIN_VALUE, 10 ** Math.floor(Math.log10(span)));
  const n = span / power;
  return Math.min(Number.MAX_VALUE, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * power);
}

const finiteBound = (value: number) => Math.max(-Number.MAX_VALUE, Math.min(Number.MAX_VALUE, value));

/** The rounded axis around [min, max] with about five steps. */
export function niceDomain(min: number, max: number): Domain {
  min = Number.isFinite(min) ? min : 0;
  max = Number.isFinite(max) ? max : 0;
  if (min > max) [min, max] = [max, min];
  const span = max - min;
  const step = niceStep(span === 0 ? Math.abs(max) / 5 : Number.isFinite(span) ? span / 5 : max / 5 - min / 5);
  const lo = Math.min(min, finiteBound(Math.floor(min / step) * step));
  const hi = Math.max(max, finiteBound(Math.max(lo + step, Math.ceil(max / step) * step)));
  return { lo, hi, step };
}

/** A finite position even when opposite-sign finite endpoints have an infinite difference. */
export function axisFraction(value: number, lo: number, hi: number): number {
  const span = hi - lo;
  if (Number.isFinite(span) && span > 0) return Math.min(1, Math.max(0, (value - lo) / span));
  const scale = Math.max(Math.abs(lo), Math.abs(hi), Math.abs(value));
  const ratio = (value / scale - lo / scale) / (hi / scale - lo / scale);
  return Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0.5;
}

/** A bounded list of distinct finite ticks, including endpoints when rounding would overflow. */
export function domainTicks({ lo, hi, step }: Domain): number[] {
  const count = Math.min(12, Math.max(2, Math.round(hi / step - lo / step) + 1));
  const first = Math.round(lo / step);
  const ticks = Number.isFinite(count)
    ? Array.from({ length: count }, (_, k) => (first + k) * step).filter(value => Number.isFinite(value) && value >= lo && value <= hi)
    : [];
  return [...new Set([lo, ...ticks, hi])];
}

/** Share of the held axis the data must still span before a shrinking reading tightens it. */
const KEEP_SHARE = 0.4;
/** Room past the data when a changing reading outgrows the held axis, so dragging on does not rescale at every step. */
const HEADROOM = 1.25;

/**
 * The value axis for data spanning [min, max]. Fixed bounds give a constant axis while the data stays inside them.
 * Otherwise a chart that already drew an axis (`held`) keeps it while the data fits and still fills a good part of
 * it: a Slider or Input changing a value then moves only that bar, instead of every bar jumping each time the rounded
 * maximum crosses a step (99 -> axis 100, 101 -> axis 125). Data that outgrows the axis widens it with headroom;
 * data that shrinks far inside tightens it. A first drawing (`held` null) is the plain rounded axis.
 */
export function valueDomain(min: number, max: number, held: Domain | null, range?: Range): Domain {
  if (range && (range.min !== undefined || range.max !== undefined)) {
    return niceDomain(Math.min(min, range.min ?? min), Math.max(max, range.max ?? max));
  }
  if (held === null || !Number.isFinite(held.lo) || !Number.isFinite(held.hi) || held.hi <= held.lo) return niceDomain(min, max);
  const fits = min >= held.lo && max <= held.hi;
  if (fits) return axisFraction(max, held.lo, held.hi) - axisFraction(min, held.lo, held.hi) >= KEEP_SHARE ? held : niceDomain(min, max);
  return niceDomain(min < held.lo ? finiteBound(min - Math.abs(min) * (HEADROOM - 1)) : held.lo, max > held.hi ? finiteBound(max + Math.abs(max) * (HEADROOM - 1)) : held.hi);
}

/** Decimals that tell neighbouring ticks apart: 0 for a step of 1000, 1 for 2.5, 4 for 0.0005, 26 for 2e-26. */
export function stepDigits(step: number) {
  // Coincident ticks (a step lost to rounding) or a missing step need no decimals.
  if (!Number.isFinite(step) || step <= 0) return 0;
  const power = Math.floor(Math.log10(step));
  const lead = step / 10 ** power;
  return Math.max(0, -power + (Math.abs(lead - Math.round(lead)) > 1e-9 ? 1 : 0));
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

type Point = [number, number];

/**
 * Stacked areas whose values run straight between neighbouring categories. The positive part of every series stacks
 * up from 0 and the negative part down from 0, so a series that changes sign between two categories splits where it
 * crosses zero instead of twisting across the layers below it.
 * @param values - values[i][s] is series s at category i.
 * @returns Per series, `bands`: the closed outline of its positive and of its negative part, outer edge forward and
 * the edge it rests on backwards (a part never thicker than 0 is left out, unless the series has no other); `edge`:
 * its outer edge as runs of points, broken where it moves between the two stacks. A point is [category, value],
 * where the category may fall between two.
 */
export function stackAreas(values: readonly (readonly number[])[]): { bands: Point[][]; edge: Point[][] }[] {
  // Every category, and every place between two where a series crosses zero (that series is exactly 0 there).
  const columns: { at: number; v: number[] }[] = [];
  values.forEach((row, i) => {
    columns.push({ at: i, v: [...row] });
    const next = values[i + 1];
    if (!next) return;
    const crossings = row.map((v, s) => {
      if (!(v < 0 && next[s] > 0 || v > 0 && next[s] < 0)) return Number.NaN;
      const scale = Math.max(Math.abs(v), Math.abs(next[s]));
      return (v / scale) / (v / scale - next[s] / scale);
    });
    for (const t of [...new Set(crossings.filter((t) => !Number.isNaN(t)))].sort((a, b) => a - b)) {
      columns.push({ at: i + t, v: row.map((v, s) => (crossings[s] === t ? 0 : v * (1 - t) + next[s] * t)) });
    }
  });
  // Each series' [base, outer edge] in the upward and in the downward stack, at every column.
  const stacks = columns.map(({ v }) => {
    let up = 0;
    let down = 0;
    return v.map((value) => ({ up: [up, (up += Math.max(0, value))], down: [down, (down += Math.min(0, value))] }));
  });
  return (values[0] ?? []).map((_, s) => {
    const part = (side: "up" | "down") => {
      const outer = columns.map(({ at }, k): Point => [at, stacks[k][s][side][1]]);
      const base = columns.map(({ at }, k): Point => [at, stacks[k][s][side][0]]);
      return { thick: outer.some(([, v], k) => v !== base[k][1]), outline: [...outer, ...base.reverse()] };
    };
    const parts = [part("up"), part("down")];
    const bands = parts.filter((p) => p.thick).map((p) => p.outline);
    // Between two columns a series stays on one side of zero, and its edge on that side's stack.
    const side = (k: number) => (columns[k].v[s] + (columns[k + 1]?.v[s] ?? 0) < 0 ? "down" : "up");
    const edge: Point[][] = [];
    for (let k = 0; k < Math.max(1, columns.length - 1); k++) {
      const from: Point = [columns[k].at, stacks[k][s][side(k)][1]];
      const last = edge.at(-1)?.at(-1);
      if (!last || last[0] !== from[0] || last[1] !== from[1]) edge.push([from]);
      if (columns[k + 1]) edge.at(-1)?.push([columns[k + 1].at, stacks[k + 1][s][side(k)][1]]);
    }
    return { bands: bands.length ? bands : [parts[0].outline], edge };
  });
}
