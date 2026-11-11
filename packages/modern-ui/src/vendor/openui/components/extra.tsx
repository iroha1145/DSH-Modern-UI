import { defineComponent } from "@openuidev/react-lang";
import "katex/dist/katex.min.css";
import { Check, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { z } from "zod/v4";
import { renderBoundedTex } from "../../primitives/markdown/katex-render";
import { copy as copyText } from "../actions";
import { inline } from "./markdown";
import { children, cx, space } from "./style";
import { useUiText } from "./ui-text";

const str = (value: unknown) => (value == null ? "" : String(value));
/** A slot that takes a component, a list of them, or plain text. */
const slot = z.union([z.string(), children]);
type Render = (value: unknown) => ReactNode;
const renderSlot = (value: unknown, renderNode: Render) =>
  typeof value === "string" || typeof value === "number" ? inline(String(value)) : renderNode(Array.isArray(value) ? value.flat() : value);
// Elements a component trigger may draw that take focus and clicks of their own.
const CONTROLS = 'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';
// A native button turns Enter and Space into the click the trigger catches, and a field takes them as text; any other
// control (a Pressable is a focusable div) acts on the keys itself, so the trigger takes them first.
const keysAreItsOwn = (element: Element) =>
  ["BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(element.tagName) || (element as HTMLElement).isContentEditable === true;

// React ownership crosses portals, unlike the inert DOM boundary of a card face.
const FaceActivityContext = createContext(true);

// Carousel
export const Carousel = defineComponent({
  name: "Carousel",
  props: z.object({ children, itemWidth: z.number().optional(), gap: z.number().optional() }),
  description: "Horizontal row that scrolls and snaps, each child an item itemWidth px wide (default 240): photos, cards, options, days.",
  component: function CarouselView({ props, renderNode }) {
    const text = useUiText();
    const ref = useRef<HTMLDivElement>(null);
    const [edges, setEdges] = useState({ start: true, end: true });
    const items = (Array.isArray(props.children) ? props.children.flat() : []).filter((c) => c != null);
    const width = Math.min(640, Math.max(80, Number.isFinite(props.itemWidth) ? props.itemWidth! : 240));
    useLayoutEffect(() => {
      const el = ref.current;
      if (!el) return;
      const read = () => setEdges({ start: el.scrollLeft < 4, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 4 });
      read();
      el.addEventListener("scroll", read, { passive: true });
      const observer = new ResizeObserver(read);
      observer.observe(el);
      return () => {
        el.removeEventListener("scroll", read);
        observer.disconnect();
      };
    }, [items.length]);
    const page = (dir: number) => {
      const el = ref.current;
      if (!el) return;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: reducedMotion ? "instant" : "smooth" });
    };
    return (
      <div className="iui-carousel">
        <div ref={ref} className="iui-carousel-track" style={{ gap: space(props.gap) }}>
          {items.map((item, i) => (
            <div key={i} className="iui-carousel-item" style={{ width }}>
              {renderNode(item)}
            </div>
          ))}
        </div>
        {!edges.start && (
          <button type="button" className="iui-carousel-nav is-prev" aria-label={text.previous} onClick={() => page(-1)}>
            <ChevronLeft size={18} />
          </button>
        )}
        {!edges.end && (
          <button type="button" className="iui-carousel-nav is-next" aria-label={text.next} onClick={() => page(1)}>
            <ChevronRight size={18} />
          </button>
        )}
      </div>
    );
  },
});

// Popover
// The panel keeps EDGE px from the viewport's edges and GAP px from its trigger, and is never taller than TALLEST.
const EDGE = 12;
const GAP = 8;
const TALLEST = 420;
// Less room than this on both sides of the trigger, and the panel may cover it rather than shrink to nothing.
const LEAST = 120;
type Placement = { left: number; top: number; maxHeight: number };

/** The panel on the side of its trigger that has room for it (below when both have), no taller than that side. */
function place(trigger: HTMLElement, panel: HTMLElement): Placement {
  const r = trigger.getBoundingClientRect();
  const [width, height] = [window.innerWidth, window.innerHeight];
  // Its height with all of its content, scrolled or not; scrollHeight leaves out the border.
  const natural = Math.min(TALLEST, panel.scrollHeight + panel.offsetHeight - panel.clientHeight);
  const below = height - EDGE - (r.bottom + GAP);
  const above = r.top - GAP - EDGE;
  const up = natural > below && above > below;
  const maxHeight = Math.max(0, Math.min(TALLEST, height - 2 * EDGE, Math.max(LEAST, up ? above : below)));
  const shown = Math.min(natural, maxHeight);
  return {
    left: Math.max(EDGE, Math.min(r.left, width - EDGE - panel.offsetWidth)),
    top: Math.max(EDGE, Math.min(up ? r.top - GAP - shown : r.bottom + GAP, height - EDGE - shown)),
    maxHeight,
  };
}

export const Popover = defineComponent({
  name: "Popover",
  props: z.object({ trigger: slot, content: slot, title: z.string().optional() }),
  description: 'Shows content in a small panel when the trigger is clicked: title names the panel; always supply it for an icon trigger. A definition, a source, details behind an Icon("info", "sm").',
  component: function PopoverView({ props, renderNode }) {
    const active = useContext(FaceActivityContext);
    const id = useId();
    const text = useUiText();
    const title = props.title?.trim();
    const [open, setOpen] = useState(false);
    const shown = open && active;
    const toggle = () => { if (active) setOpen((current) => !current); };
    useLayoutEffect(() => {
      if (!active) setOpen(false);
    }, [active]);
    const [at, setAt] = useState<Placement | null>(null);
    const button = useRef<HTMLElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const body = useRef<HTMLDivElement>(null);
    const entered = useRef(false);
    useLayoutEffect(() => {
      if (!shown) entered.current = false;
      else if (at && !entered.current) {
        panel.current?.focus();
        entered.current = true;
      }
    });
    // A component trigger that draws its own control (a Button) opens the panel through that control, which then
    // neither runs its action nor sits inside a second focusable wrapper.
    const [control, setControl] = useState<HTMLElement | null>(null);
    const [hasTriggerText, setHasTriggerText] = useState(false);
    useLayoutEffect(() => {
      const found = typeof props.trigger === "string" ? null : button.current?.querySelector<HTMLElement>(CONTROLS) ?? null;
      setControl((current) => (current === found ? current : found));
      setHasTriggerText(!!button.current?.textContent?.trim());
    });
    useLayoutEffect(() => {
      if (!control) return;
      control.setAttribute("aria-haspopup", "dialog");
      control.setAttribute("aria-controls", `${id}-panel`);
      control.setAttribute("aria-expanded", String(shown));
    }, [control, shown, id]);
    // Measured before the first paint, and again whenever the viewport, the trigger or the content changes size.
    useLayoutEffect(() => {
      if (!shown) return;
      const update = () => {
        if (!button.current || !panel.current) return;
        const next = place(button.current, panel.current);
        setAt((current) => (current?.left === next.left && current.top === next.top && current.maxHeight === next.maxHeight ? current : next));
      };
      update();
      const observer = new ResizeObserver(update);
      for (const element of [button.current, body.current]) if (element) observer.observe(element);
      window.addEventListener("resize", update);
      return () => {
        observer.disconnect();
        window.removeEventListener("resize", update);
      };
    }, [shown]);
    useEffect(() => {
      if (!shown) return;
      const close = (event: Event) => {
        const target = event.target as Node;
        if (!panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
      };
      // The panel takes its own Escape, so the composer or a panel around the answer does not also close; a modal
      // dialog opened above it keeps the key.
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Escape" || (event.target as Element | null)?.closest?.('[role="dialog"][aria-modal="true"]')) return;
        event.stopPropagation();
        const focused = panel.current?.contains(document.activeElement) === true;
        setOpen(false);
        if (focused) (control ?? button.current)?.focus();
      };
      // Scrolling the page moves the trigger away; scrolling inside the panel (a table, code) does not.
      const onScroll = (event: Event) => {
        if (!panel.current?.contains(event.target as Node)) setOpen(false);
      };
      document.addEventListener("pointerdown", close);
      document.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("scroll", onScroll, true);
      return () => {
        document.removeEventListener("pointerdown", close);
        document.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("scroll", onScroll, true);
      };
    }, [shown, control]);
    return (
      <>
        {typeof props.trigger === "string" ? (
          <button ref={button as RefObject<HTMLButtonElement>} type="button" id={`${id}-trigger`} className="iui-popover-trigger" aria-haspopup="dialog" aria-controls={`${id}-panel`} aria-expanded={shown} onClick={toggle}>
            {props.trigger}
          </button>
        ) : control ? (
          // The trigger's own control is the button: its click, and the keys that would run its action, are caught
          // before they reach it.
          <span
            ref={button as RefObject<HTMLSpanElement>}
            id={`${id}-trigger`} className="iui-popover-trigger"
            onClickCapture={(event) => {
              event.stopPropagation();
              toggle();
            }}
            onKeyDownCapture={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              const target = (event.target as Element).closest(CONTROLS);
              if (target === null || keysAreItsOwn(target)) return;
              event.preventDefault();
              event.stopPropagation();
              toggle();
            }}
          >
            {renderSlot(props.trigger, renderNode)}
          </span>
        ) : (
          // A component trigger may hold its own button, and a button cannot contain another one.
          <span
            ref={button as RefObject<HTMLSpanElement>}
            role="button"
            tabIndex={0}
            aria-label={!hasTriggerText ? title || text.details : undefined}
            id={`${id}-trigger`} className="iui-popover-trigger"
            aria-haspopup="dialog" aria-controls={`${id}-panel`} aria-expanded={shown}
            onClick={toggle}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
              event.preventDefault();
              toggle();
            }}
          >
            {renderSlot(props.trigger, renderNode)}
          </span>
        )}
        {shown &&
          createPortal(
            // The panel leaves the block's DOM, so it carries its own scope for the tokens and styles. It is laid out
            // hidden once, to be measured, before it is placed.
            <div className="iui-root iui-portal" data-theme={button.current?.closest("[data-theme]")?.getAttribute("data-theme") ?? undefined}>
              <div ref={panel} id={`${id}-panel`} role="dialog" tabIndex={-1} aria-labelledby={title ? `${id}-title` : typeof props.trigger === "string" ? `${id}-trigger` : undefined} aria-label={!title && typeof props.trigger !== "string" ? (control?.getAttribute("aria-label") || control?.textContent || button.current?.textContent)?.trim() || text.details : undefined} className="iui-popover" style={at ? { left: at.left, top: at.top, maxHeight: at.maxHeight } : { left: 0, top: 0, visibility: "hidden" }}>
                <div ref={body} className="iui-popover-body">
                  {title && <div id={`${id}-title`} className="iui-label">{title}</div>}
                  {renderSlot(props.content, renderNode)}
                </div>
              </div>
            </div>,
            document.body,
          )}
      </>
    );
  },
});

// Code, quote, math
export const Code = defineComponent({
  name: "Code",
  props: z.object({ code: z.string(), language: z.string().optional() }),
  description: "Code block with a copy button.",
  component: function CodeView({ props }) {
    const text = useUiText();
    const [copied, setCopied] = useState(false);
    const reset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(reset.current), []);
    const code = str(props.code);
    // The shared copy falls back to a selection where the Clipboard API is missing (plain-HTTP LAN pages).
    const copy = () =>
      void copyText(code).then((ok) => {
        if (!ok) return;
        setCopied(true);
        // A second copy restarts the confirmation instead of letting the first one's timer cut it short.
        clearTimeout(reset.current);
        reset.current = setTimeout(() => setCopied(false), 1500);
      });
    return (
      <div className="iui-codeblock">
        <div className="iui-codeblock-head">
          <span>{str(props.language) || text.code}</span>
          <button type="button" onClick={copy} aria-label={text.copyCode}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? text.copied : text.copy}
          </button>
        </div>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  },
});

export const Quote = defineComponent({
  name: "Quote",
  props: z.object({ text: z.string(), cite: z.string().optional() }),
  description: "A quotation or a callout on a soft panel; cite names the source.",
  component: ({ props }) => (
    <blockquote className="iui-quote">
      <p>{inline(str(props.text))}</p>
      {props.cite ? <cite>{inline(str(props.cite))}</cite> : null}
    </blockquote>
  ),
});

export const MathBlock = defineComponent({
  name: "Math",
  props: z.object({ tex: z.string(), inline: z.boolean().optional() }),
  description: 'LaTeX formula, e.g. Math("E = mc^2"); inline true to sit in a Text list.',
  component: ({ props }) => {
    const { html } = renderBoundedTex(str(props.tex), { displayMode: !props.inline, throwOnError: false, strict: "ignore", output: "htmlAndMathml" });
    // KaTeX escapes its input and is configured without \href or \includegraphics.
    return props.inline ? <span className="iui-math" dangerouslySetInnerHTML={{ __html: html }} /> : <div className="iui-math is-block" dangerouslySetInnerHTML={{ __html: html }} />;
  },
});

// Play
export const Flashcard = defineComponent({
  name: "Flashcard",
  props: z.object({ front: slot, back: slot, hint: z.string().optional() }),
  description: "Card with a flip button to switch between front and back. Put several in a Carousel or Grid.",
  component: function FlashcardView({ props, renderNode }) {
    const active = useContext(FaceActivityContext);
    const text = useUiText();
    const [flipped, setFlipped] = useState(false);
    const front = useRef<HTMLDivElement>(null);
    const back = useRef<HTMLDivElement>(null);
    const toggle = useRef<HTMLButtonElement>(null);
    const frontFocus = useRef<EventTarget | null>(null);
    const backFocus = useRef<EventTarget | null>(null);
    useLayoutEffect(() => {
      if (front.current) front.current.inert = flipped;
      if (back.current) back.current.inert = !flipped;
    }, [flipped]);
    const flip = () => {
      // React focus capture also sees owned portal content outside the face DOM.
      // An outer flip owns restoration when this whole card is becoming inert.
      if (active && ((flipped ? back : front).current?.contains(document.activeElement)
        || (flipped ? backFocus : frontFocus).current === document.activeElement)) toggle.current?.focus();
      setFlipped(!flipped);
    };
    const face = (value: unknown) => (typeof value === "string" ? <span className="iui-flashcard-word">{inline(value)}</span> : renderSlot(value, renderNode));
    return (
      <article className={cx("iui-flashcard", flipped && "is-flipped")}>
        <div className="iui-flashcard-inner">
          <div ref={front} className="iui-flashcard-face is-front" aria-hidden={flipped} onFocusCapture={(event) => { frontFocus.current = event.target; }}>
            <FaceActivityContext.Provider value={active && !flipped}>
              {face(props.front)}
              {props.hint && <span className="iui-flashcard-hint">{str(props.hint)}</span>}
            </FaceActivityContext.Provider>
          </div>
          <div ref={back} className="iui-flashcard-face is-back" aria-hidden={!flipped} onFocusCapture={(event) => { backFocus.current = event.target; }}>
            <FaceActivityContext.Provider value={active && flipped}>
              {face(props.back)}
            </FaceActivityContext.Provider>
          </div>
        </div>
        <button ref={toggle} type="button" className="iui-flashcard-toggle" aria-pressed={flipped} onClick={flip}>{text.tapToFlip}</button>
      </article>
    );
  },
});
