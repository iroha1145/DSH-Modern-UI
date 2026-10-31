import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";
import { inline } from "./markdown";
import { cx } from "./style";

const NUMERIC = /^[-+−]?[$€£¥₹]?\s?\d[\d,]*(\.\d+)?\s?(%|[kKmMbB]|bn)?$/;
const isElement = (value: unknown) => !!value && typeof value === "object" && (value as { type?: unknown }).type === "element";

/**
 * A number cell without hiding small values: integers get separators, values of 1 or more keep up to four
 * decimals, smaller ones four significant digits, and tiny ones scientific notation.
 */
export function numberText(value: number): string {
  if (!Number.isFinite(value) || Number.isInteger(value)) return value.toLocaleString("en-US");
  const abs = Math.abs(value);
  if (abs < 1e-4) return value.toExponential(2);
  if (abs < 1) return value.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export const Table = defineComponent({
  name: "Table",
  props: z.object({
    columns: z.array(z.string()),
    rows: z.array(z.array(z.any())),
  }),
  description: "Each row lists its cells in column order; a cell may be a component. Number columns align right.",
  component: ({ props, renderNode }) => {
    const columns = Array.isArray(props.columns) ? props.columns.map((c) => String(c ?? "")) : [];
    const rows = (Array.isArray(props.rows) ? props.rows : []).filter(Array.isArray) as unknown[][];
    // A column of numbers (or amounts like "$1.2k" and "45%") aligns right.
    const numeric = columns.map((_, c) => {
      const cells = rows.map((r) => r[c]).filter((v) => v != null && v !== "" && !(typeof v === "string" && /^(n\/a|\u2014|\u2013|-)$/i.test(v.trim())));
      return cells.length > 0 && cells.every((v) => typeof v === "number" || (typeof v === "string" && NUMERIC.test(v.trim())));
    });
    const cell = (value: unknown) =>
      isElement(value) ? renderNode(value) : typeof value === "number" ? numberText(value) : inline(String(value ?? ""));
    return (
      <div className="iui-table-scroll">
        <table className="iui-table">
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={i} className={cx(numeric[i] && "is-numeric")}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {columns.map((_, c) => (
                  <td key={c} className={cx(numeric[c] && "is-numeric")}>
                    {cell(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  },
});
