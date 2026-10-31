import {
  action,
  defineComponent,
  reactive,
  useFormName,
  useIsStreaming,
  useStateField,
  useTriggerAction,
} from "@openuidev/react-lang";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { z } from "zod/v4";
import { useField, useFieldName } from "./fields";
import { Glyph } from "./glyph";
import { bg, children, color, onColor, cx, option, radius, radiusSchema, space, textOf, toOption, type Option } from "./style";
import { useUiText } from "./ui-text";

type Plan = Parameters<ReturnType<typeof useTriggerAction>>[2];

/** Runs an action prop. With no action, a button sends its label to the assistant. */
function useRunAction() {
  const trigger = useTriggerAction();
  const formName = useFormName();
  return (message: string, plan: unknown, sendLabel: boolean) => {
    if (plan) void trigger(message, formName, plan as Plan);
    else if (sendLabel) void trigger(message, formName);
  };
}


// Decimal places a number is written with, e.g. 0.25 has 2 and 1e-7 has 7.
const decimals = (value: number) => {
  const [digits = "", exponent = "0"] = String(value).split("e");
  return Math.max(0, (digits.split(".")[1]?.length ?? 0) - Number(exponent));
};

/** A slider value with at least two decimals or as many as its step and minimum use, never a non-zero value as 0. */
const numberText = (value: number, step: number, min: number) => {
  if (!Number.isFinite(value)) return "";
  const places = Math.min(20, Math.max(2, decimals(step), decimals(min)));
  const text = value.toLocaleString("en-US", { maximumFractionDigits: places });
  return value !== 0 && /^-?0$/.test(text) ? value.toLocaleString("en-US", { maximumSignificantDigits: 2 }) : text;
};

/**
 * The value a range input keeps, as browsers sanitize it: clamped to the bounds, then the nearest min + k·step
 * (a tie goes up), never past max.
 */
const rangeValue = (value: number, min: number, max: number, step: number) => {
  const places = Math.min(20, Math.max(decimals(step), decimals(min)));
  const at = (k: number) => Number((min + k * step).toFixed(places));
  // The small allowance keeps float noise (0.15 / 0.1 = 1.4999…) from moving a value off its step.
  const k = Math.round((Math.min(max, Math.max(min, value)) - min) / step + 1e-9);
  return at(k) > max ? at(Math.floor((max - min) / step + 1e-9)) : at(k);
};

/**
 * False while the block streams and in the commit that ends it, before the renderer applies the final $variable
 * defaults: a control normalising its value then would act on a half-written bound or option list, or write a
 * value that does not exist yet over its declared default.
 */
function useSettled() {
  const streaming = useIsStreaming();
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(!streaming);
  }, [streaming]);
  return settled && !streaming;
}

/**
 * Clears a choice control whose value is no longer among its options (an @Set replaced them), so formulas and
 * @ToAssistant agree with the empty selection it shows instead of keeping a value no option displays.
 */
function useClearMissingChoice(field: { value: unknown; setValue: (value: string) => void }, values: string[]) {
  const settled = useSettled();
  const value = field.value == null ? "" : String(field.value);
  useLayoutEffect(() => {
    if (settled && value !== "" && !values.includes(value)) field.setValue("");
  });
}

function Field({ label, children: content }: { label?: string; children: ReactNode }) {
  if (!label) return <>{content}</>;
  return (
    <label className="iui-field">
      <span className="iui-label">{label}</span>
      {content}
    </label>
  );
}

// Actions
export const Button = defineComponent({
  name: "Button",
  props: z.object({
    label: z.string(),
    action: action().optional(),
    variant: z.enum(["solid", "outline", "soft", "ghost"]).optional(),
    color: z.enum(["primary", "danger", "success"]).optional(),
    size: z.enum(["sm", "md", "lg"]).optional(),
    icon: z.string().optional(),
    disabled: z.boolean().optional(),
    block: z.boolean().optional(),
  }),
  description: "icon is a lucide name.",
  component: ({ props }) => {
    const run = useRunAction();
    const streaming = useIsStreaming();
    const label = String(props.label ?? "");
    return (
      <button
        type="button"
        className={cx(
          "iui-button",
          `iui-button-${props.variant ?? "solid"}`,
          props.color && props.color !== "primary" && `iui-button-${props.color}`,
          `iui-button-${props.size ?? "md"}`,
          props.block && "iui-block",
        )}
        disabled={!!props.disabled || streaming}
        onClick={() => run(label, props.action, true)}
      >
        {props.icon ? <Glyph name={props.icon} size={props.size === "sm" ? 14 : 16} /> : null}
        {label}
      </button>
    );
  },
});

export const IconButton = defineComponent({
  name: "IconButton",
  props: z.object({
    icon: z.string(),
    action: action().optional(),
    label: z.string().optional(),
    variant: z.enum(["outline", "ghost", "solid"]).optional(),
  }),
  description: "Round icon-only button; label is read aloud.",
  component: ({ props }) => {
    const run = useRunAction();
    const streaming = useIsStreaming();
    const label = props.label || String(props.icon ?? "");
    return (
      <button
        type="button"
        className={cx("iui-icon-button", `iui-icon-button-${props.variant ?? "outline"}`)}
        aria-label={label}
        title={props.label || undefined}
        disabled={streaming}
        onClick={() => run(label, props.action, false)}
      >
        <Glyph name={props.icon} size={16} />
      </button>
    );
  },
});

export const Pressable = defineComponent({
  name: "Pressable",
  props: z.object({
    children,
    action: action().optional(),
    selected: z.boolean().optional(),
    padding: z.number().optional(),
    background: color.optional(),
    radius: radiusSchema.optional(),
  }),
  description: "Makes any content clickable, such as a tile or a swatch.",
  component: function PressableView({ props, renderNode }) {
    const run = useRunAction();
    const streaming = useIsStreaming();
    const ref = useRef<HTMLDivElement>(null);
    const press = () => {
      if (!streaming) run(textOf(ref.current), props.action, false);
    };
    // Clicks meant for a control inside the tile stay with that control.
    const onClick = (event: MouseEvent<HTMLDivElement>) => {
      const target = (event.target as Element).closest("button,a,input,select,textarea,label,[role=button]");
      if (target === event.currentTarget) press();
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      press();
    };
    return (
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        aria-pressed={props.selected === undefined ? undefined : !!props.selected}
        aria-disabled={streaming || undefined}
        className={cx("iui-pressable", props.selected && "is-selected")}
        style={{ padding: space(props.padding), background: bg(props.background), ...onColor(props.background), borderRadius: radius(props.radius) }}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        {renderNode(props.children)}
      </div>
    );
  },
});

// Inputs
export const Input = defineComponent({
  name: "Input",
  props: z.object({
    value: reactive(z.union([z.string(), z.number()])),
    label: z.string().optional(),
    type: z.enum(["text", "number"]).optional(),
    placeholder: z.string().optional(),
  }),
  description: "Text or number field; a number field stores numbers.",
  component: function InputView({ props, statementId }) {
    const field = useField(props.label, statementId, props.value);
    const numeric = props.type === "number";
    // A number field shows what is typed ("1." or "-") until it parses.
    const [draft, setDraft] = useState<string | null>(null);
    const shown = draft ?? (numeric ? (typeof field.value === "number" ? String(field.value) : String(field.value ?? "")) : String(field.value ?? ""));
    return (
      <Field label={props.label}>
        <input
          className="iui-input"
          type="text"
          inputMode={numeric ? "decimal" : undefined}
          value={shown}
          placeholder={props.placeholder}
          aria-label={props.label ? undefined : props.placeholder}
          onChange={(event) => {
            const text = event.target.value;
            if (!numeric) return field.setValue(text);
            setDraft(text);
            const parsed = Number(text.replace(/,/g, ""));
            if (text.trim() === "") field.setValue(null as unknown as number);
            else if (Number.isFinite(parsed)) field.setValue(parsed);
          }}
          onBlur={() => setDraft(null)}
        />
      </Field>
    );
  },
});

export const TextArea = defineComponent({
  name: "TextArea",
  props: z.object({
    value: reactive(z.string()),
    label: z.string().optional(),
    placeholder: z.string().optional(),
    rows: z.number().optional(),
  }),
  description: "",
  component: ({ props, statementId }) => {
    const field = useField(props.label, statementId, props.value);
    return (
      <Field label={props.label}>
        <textarea
          className="iui-input iui-textarea"
          rows={Math.min(20, Math.max(2, Math.round(props.rows ?? 3)))}
          value={String(field.value ?? "")}
          placeholder={props.placeholder}
          aria-label={props.label ? undefined : props.placeholder}
          onChange={(event) => field.setValue(event.target.value)}
        />
      </Field>
    );
  },
});

const options = z.array(option);
const optionList = (value: unknown) => (Array.isArray(value) ? (value.flat() as Option[]).filter((o) => o != null).map(toOption) : []);

export const Select = defineComponent({
  name: "Select",
  props: z.object({
    value: reactive(z.string()),
    options,
    label: z.string().optional(),
    placeholder: z.string().optional(),
  }),
  description: "Dropdown, for long option lists.",
  component: function SelectView({ props, statementId }) {
    const text = useUiText();
    const field = useField(props.label, statementId, props.value);
    const choices = optionList(props.options);
    useClearMissingChoice(field, choices.map((o) => o.value));
    const value = field.value == null ? "" : String(field.value);
    return (
      <Field label={props.label}>
        <select className="iui-input iui-select" value={value} aria-label={props.label ? undefined : props.placeholder} onChange={(event) => field.setValue(event.target.value)}>
          {(props.placeholder || !choices.some((o) => o.value === value)) && (
            <option value="" disabled>
              {props.placeholder ?? text.choose}
            </option>
          )}
          {choices.map((o, i) => (
            <option key={`${o.value}-${i}`} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
    );
  },
});

export const SegmentedControl = defineComponent({
  name: "SegmentedControl",
  props: z.object({ value: reactive(z.string()), options, block: z.boolean().optional() }),
  description: "2 to 4 short choices in a row.",
  component: function SegmentedView({ props, statementId }) {
    const field = useField(undefined, statementId, props.value);
    const choices = optionList(props.options);
    useClearMissingChoice(field, choices.map((o) => o.value));
    const value = field.value == null ? "" : String(field.value);
    return (
      <div className={cx("iui-segmented", props.block && "iui-block")} role="radiogroup">
        {choices.map((o, i) => (
          <button
            key={`${o.value}-${i}`}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            className={cx(o.value === value && "is-selected")}
            onClick={() => field.setValue(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  },
});

export const Slider = defineComponent({
  name: "Slider",
  props: z.object({
    value: reactive(z.number()),
    min: z.number(),
    max: z.number(),
    step: z.number().optional(),
    label: z.string().optional(),
    unit: z.string().optional(),
    marks: z.array(z.object({ value: z.number(), label: z.string() })).optional(),
  }),
  description: 'Shows label and value; unit like "%" or "$" formats the value.',
  component: function SliderView({ props, statementId }) {
    const text = useUiText();
    const field = useField(props.label, statementId, props.value);
    const settled = useSettled();
    const min = Number.isFinite(props.min) ? props.min : 0;
    const max = Number.isFinite(props.max) && props.max > min ? props.max : min + 100;
    const step = props.step && props.step > 0 ? props.step : 1;
    const raw = typeof field.value === "number" ? field.value : Number(field.value);
    // What the native range shows: the browser clamps and snaps whatever value it is given.
    const value = Number.isFinite(raw) ? rangeValue(raw, min, max, step) : min;
    // The stored value is the intended one clamped to the current bounds and snapped to the step, so formulas
    // and @ToAssistant use the value the slider shows. The intended value is the last one anyone but this
    // normalisation chose (the default, a drag, @Set, another control): narrowing a bound or coarsening the step
    // moves the stored value, undoing it returns toward the intended one, so typing a bound digit by digit
    // (100, 5, 50) does not leave the value at 5. Only once settled (see useSettled), and at most one write per
    // task, so two sliders with disjoint bounds on one $variable cannot correct each other forever.
    const intended = useRef(Number.NaN);
    // The stored value as this slider last saw or wrote it; anything else is a new choice.
    const seen = useRef(Number.NaN);
    const clamping = useRef(false);
    useLayoutEffect(() => {
      if (!settled || !Number.isFinite(raw)) return;
      if (raw !== seen.current) intended.current = seen.current = raw;
      const target = rangeValue(intended.current, min, max, step);
      if (target === raw || clamping.current) return;
      clamping.current = true;
      queueMicrotask(() => {
        clamping.current = false;
      });
      seen.current = target;
      field.setValue(target);
    });
    const unit = props.unit ?? "";
    const prefix = /^[$€£¥₹]/.test(unit);
    const shown = numberText(value, step, min);
    const readout = prefix ? `${unit}${shown}` : `${shown}${unit}`;
    const marks = (props.marks ?? []).filter((m) => m && Number.isFinite(m.value) && m.value >= min && m.value <= max);
    const id = useId();
    return (
      <div className="iui-slider">
        {(props.label || props.unit) && (
          <div className="iui-slider-head">
            <label htmlFor={id}>{props.label}</label>
            <output htmlFor={id}>{readout}</output>
          </div>
        )}
        <input
          id={id}
          className="iui-range"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={props.label ? undefined : text.value}
          aria-valuetext={readout}
          onChange={(event) => field.setValue(Number(event.target.value))}
        />
        {marks.length > 0 && (
          <div className="iui-slider-marks" aria-hidden>
            {marks.map((m, i) => {
              const at = (m.value - min) / (max - min);
              return (
                <span key={i} className={cx(at <= 0.02 && "is-start", at >= 0.98 && "is-end")} style={{ left: `calc(9px + (100% - 18px) * ${at})` }}>
                  {m.label}
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  },
});

export const Checkbox = defineComponent({
  name: "Checkbox",
  props: z.object({ checked: reactive(z.boolean()), label: z.string(), lineThrough: z.boolean().optional() }),
  description: "lineThrough strikes the label when checked, for to-do lists.",
  component: ({ props, statementId }) => {
    const field = useField(props.label, statementId, props.checked);
    const checked = field.value === true;
    return (
      <label className={cx("iui-check", checked && props.lineThrough && "is-done")}>
        <input type="checkbox" checked={checked} onChange={(event) => field.setValue(event.target.checked)} />
        <span>{String(props.label ?? "")}</span>
      </label>
    );
  },
});

const choice = z.union([z.string(), z.object({ value: z.string(), label: z.string(), description: z.string().optional() })]);
type Choice = { value: string; label: string; description?: string };
const choiceList = (value: unknown): Choice[] =>
  Array.isArray(value) ? (value.flat() as (string | Choice)[]).filter((o) => o != null).map((o) => (typeof o === "string" ? { value: o, label: o } : o)) : [];

export const RadioGroup = defineComponent({
  name: "RadioGroup",
  props: z.object({
    value: reactive(z.string()),
    options: z.array(choice),
    label: z.string().optional(),
    variant: z.enum(["list", "pills", "cards"]).optional(),
  }),
  description: "pills for short choices; cards for choices that need a description line.",
  component: function RadioGroupView({ props, statementId }) {
    const field = useField(props.label, statementId, props.value);
    const name = useId();
    const choices = choiceList(props.options);
    useClearMissingChoice(field, choices.map((o) => o.value));
    const value = field.value == null ? "" : String(field.value);
    const variant = props.variant ?? "list";
    return (
      <fieldset className={cx("iui-radio-group", `iui-radio-${variant}`)}>
        {props.label ? <legend className="iui-label">{props.label}</legend> : null}
        <div>
          {choices.map((o, i) => (
            <label key={`${o.value}-${i}`} className={cx(variant === "list" ? "iui-check" : "iui-choice", o.value === value && "is-selected")}>
              <input type="radio" name={name} checked={o.value === value} onChange={() => field.setValue(o.value)} />
              <span className="iui-choice-text">
                <span>{o.label}</span>
                {o.description ? <span className="iui-choice-description">{o.description}</span> : null}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  },
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const DatePicker = defineComponent({
  name: "DatePicker",
  props: z.object({
    value: reactive(z.string()),
    label: z.string().optional(),
    min: z.string().optional(),
    max: z.string().optional(),
  }),
  description: 'Dates are "YYYY-MM-DD".',
  component: function DatePickerView({ props, statementId }) {
    const text = useUiText();
    const field = useField(props.label, statementId, props.value);
    const value = typeof field.value === "string" && DATE.test(field.value) ? field.value : "";
    return (
      <Field label={props.label}>
        <input
          className="iui-input iui-date"
          type="date"
          value={value}
          min={props.min && DATE.test(props.min) ? props.min : undefined}
          max={props.max && DATE.test(props.max) ? props.max : undefined}
          aria-label={props.label ? undefined : text.date}
          onChange={(event) => field.setValue(event.target.value)}
        />
      </Field>
    );
  },
});

const clock = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
};

export const Timer = defineComponent({
  name: "Timer",
  props: z.object({
    seconds: reactive(z.number()),
    label: z.string().optional(),
  }),
  description: "Countdown with start, pause and reset. It counts the bound seconds down to 0, so other statements can react, e.g. $left == 0.",
  component: function TimerView({ props, statementId }) {
    const text = useUiText();
    const field = useStateField(useFieldName(statementId), props.seconds);
    const streaming = useIsStreaming();
    const raw = typeof field.value === "number" ? field.value : Number(field.value);
    const left = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
    const [running, setRunning] = useState(false);
    // The ticking interval reads the latest value and setter, not the ones from when it started
    const live = useRef({ left, setValue: field.setValue });
    live.current = { left, setValue: field.setValue };
    // What Reset goes back to: the value when the countdown first started
    const [startedAt, setStartedAt] = useState<number | null>(null);

    useEffect(() => {
      if (!running) return;
      const id = setInterval(() => {
        const next = Math.max(0, live.current.left - 1);
        live.current.left = next;
        live.current.setValue(next);
        if (next === 0) setRunning(false);
      }, 1000);
      return () => clearInterval(id);
    }, [running]);

    const toggle = () => {
      if (!running && startedAt === null) setStartedAt(left);
      setRunning(!running);
    };
    const reset = () => {
      setRunning(false);
      if (startedAt !== null) field.setValue(startedAt);
      setStartedAt(null);
    };
    const done = left === 0 && startedAt !== null;
    return (
      <div className={cx("iui-timer", running && "is-running", done && "is-done")} role="timer" aria-label={props.label || text.timer}>
        <div className="iui-timer-read">
          {props.label && <span className="iui-label">{props.label}</span>}
          <span className="iui-timer-time">{clock(left)}</span>
        </div>
        <div className="iui-timer-actions">
          <button type="button" className="iui-button iui-button-solid iui-button-sm" disabled={streaming || left === 0} onClick={toggle}>
            <Glyph name={running ? "pause" : "play"} size={14} />
            {running ? text.pause : startedAt === null || left === 0 ? text.start : text.resume}
          </button>
          <button type="button" className="iui-button iui-button-ghost iui-button-sm" disabled={streaming || startedAt === null} onClick={reset}>
            <Glyph name="rotate-ccw" size={14} />
            {text.reset}
          </button>
        </div>
      </div>
    );
  },
});
