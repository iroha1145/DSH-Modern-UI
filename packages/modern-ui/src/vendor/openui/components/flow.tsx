/** Top-down diagrams for architectures, request paths and processes; not part of the upstream library. */
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";
import { Glyph } from "./glyph";
import { inline } from "./markdown";
import { children, cx } from "./style";

const str = (value: unknown) => (value == null ? "" : String(value));
const tone = z.enum(["neutral", "info", "success", "warning", "danger"]);

export const FlowNode = defineComponent({
  name: "FlowNode",
  props: z.object({
    title: z.string(),
    detail: z.string().optional(),
    icon: z.string().optional(),
    tone: tone.optional(),
  }),
  description: "A box in a diagram: a component, step or state. detail is one short line; icon is a lucide name.",
  component: ({ props }) => (
    <div className={cx("iui-diagram-node", props.tone && props.tone !== "neutral" && `is-${props.tone}`)}>
      {props.icon ? <Glyph name={props.icon} size={18} className="iui-diagram-icon" /> : null}
      <div className="iui-diagram-text">
        <strong>{inline(str(props.title))}</strong>
        {props.detail ? <span>{inline(str(props.detail))}</span> : null}
      </div>
    </div>
  ),
});

export const FlowArrow = defineComponent({
  name: "FlowArrow",
  props: z.object({ label: z.string().optional() }),
  description: "A downward arrow between two diagram rows; label names the call, data or condition.",
  component: ({ props }) => (
    <div className="iui-diagram-arrow" role="presentation">
      <svg viewBox="0 0 12 28" width="12" height="28" aria-hidden>
        <path d="M6 1v24M1.5 20.5 6 25.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {props.label ? <span>{inline(str(props.label))}</span> : null}
    </div>
  ),
});

export const FlowRow = defineComponent({
  name: "FlowRow",
  props: z.object({ children }),
  description: "Diagram nodes side by side at one level: parallel services, branches or outcomes.",
  component: ({ props, renderNode }) => <div className="iui-diagram-row">{renderNode(props.children)}</div>,
});

export const FlowGroup = defineComponent({
  name: "FlowGroup",
  props: z.object({ title: z.string(), children, direction: z.enum(["col", "row"]).optional() }),
  description: "A dashed boundary around part of a diagram: a host, container, trust zone or phase. row lays its children side by side.",
  component: ({ props, renderNode }) => (
    <div className={cx("iui-diagram-group", props.direction === "row" && "is-row")}>
      <div className="iui-diagram-group-title">{inline(str(props.title))}</div>
      <div className="iui-diagram-group-body">{renderNode(props.children)}</div>
    </div>
  ),
});

export const Flow = defineComponent({
  name: "Flow",
  props: z.object({ children, caption: z.string().optional() }),
  description:
    "Centered top-down diagram for an architecture, request path or process: FlowNode rows joined by FlowArrow, FlowRow for nodes side by side, FlowGroup for a boundary.",
  component: ({ props, renderNode }) => (
    <figure className="iui-diagram">
      {props.caption ? <figcaption className="iui-diagram-caption">{inline(str(props.caption))}</figcaption> : null}
      {renderNode(props.children)}
    </figure>
  ),
});
