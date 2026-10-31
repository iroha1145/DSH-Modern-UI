import { defineComponent } from "@openuidev/react-lang";
import katex from "katex";
import "katex/dist/katex.min.css";
import { Check, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { z } from "zod/v4";
import { copy as copyText } from "../actions";
import { inline } from "./markdown";
import { children, cx } from "./style";
import { useUiText } from "./ui-text";

const str = (value: unknown) => (value == null ? "" : String(value));
/** A slot that takes a component, a list of them, or plain text. */
const slot = z.union([z.string(), children]);
type Render = (value: unknown) => ReactNode;
const renderSlot = (value: unknown, renderNode: Render) =>
  typeof value === "string" || typeof value === "number" ? inline(String(value)) : renderNode(Array.isArray(value) ? value.flat() : value);

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
    const width = Math.min(640, Math.max(80, props.itemWidth ?? 240));
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
    const page = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: "smooth" });
    return (
      <div className="iui-carousel">
        <div ref={ref} className="iui-carousel-track" style={{ gap: props.gap != null ? Math.max(0, props.gap) * 4 : undefined }}>
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
export const Popover = defineComponent({
  name: "Popover",
  props: z.object({ trigger: slot, content: slot }),
  description: 'Shows content in a small panel when the trigger is clicked: a definition, a source, details behind an Icon("info", "sm").',
  component: function PopoverView({ props, renderNode }) {
    const [open, setOpen] = useState(false);
    const [at, setAt] = useState<{ left: number; top: number; up: boolean } | null>(null);
    const button = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      if (!open || !button.current) return;
      const r = button.current.getBoundingClientRect();
      const up = r.bottom + 220 > window.innerHeight && r.top > 240;
      setAt({ left: Math.min(Math.max(12, r.left), window.innerWidth - 292), top: up ? r.top - 8 : r.bottom + 8, up });
    }, [open]);
    useEffect(() => {
      if (!open) return;
      const close = (event: Event) => {
        const target = event.target as Node;
        if (event.type === "keydown" ? (event as KeyboardEvent).key === "Escape" : !panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
      };
      const onScroll = () => setOpen(false);
      document.addEventListener("pointerdown", close);
      document.addEventListener("keydown", close);
      window.addEventListener("scroll", onScroll, true);
      return () => {
        document.removeEventListener("pointerdown", close);
        document.removeEventListener("keydown", close);
        window.removeEventListener("scroll", onScroll, true);
      };
    }, [open]);
    return (
      <>
        <button ref={button} type="button" className="iui-popover-trigger" aria-expanded={open} onClick={() => setOpen(!open)}>
          {renderSlot(props.trigger, renderNode)}
        </button>
        {open &&
          at &&
          createPortal(
            // The panel leaves the block's DOM, so it carries its own scope for the tokens and styles.
            <div className="iui-root iui-portal" data-theme={button.current?.closest("[data-theme]")?.getAttribute("data-theme") ?? undefined}>
              <div
                ref={panel}
                role="dialog"
                className="iui-popover"
                style={{ left: at.left, top: at.top, transform: at.up ? "translateY(-100%)" : undefined }}
              >
                {renderSlot(props.content, renderNode)}
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
    const code = str(props.code);
    // The shared copy falls back to a selection where the Clipboard API is missing (plain-HTTP LAN pages).
    const copy = () =>
      void copyText(code).then((ok) => {
        if (!ok) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
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
    const html = katex.renderToString(str(props.tex), { displayMode: !props.inline, throwOnError: false, trust: false, strict: "ignore", output: "htmlAndMathml" });
    // KaTeX escapes its input and is configured without \href or \includegraphics.
    return props.inline ? <span className="iui-math" dangerouslySetInnerHTML={{ __html: html }} /> : <div className="iui-math is-block" dangerouslySetInnerHTML={{ __html: html }} />;
  },
});

// Play
export const Flashcard = defineComponent({
  name: "Flashcard",
  props: z.object({ front: slot, back: slot, hint: z.string().optional() }),
  description: "Card that flips between front and back when tapped. Put several in a Carousel or Grid.",
  component: function FlashcardView({ props, renderNode }) {
    const text = useUiText();
    const [flipped, setFlipped] = useState(false);
    const face = (value: unknown) => (typeof value === "string" ? <span className="iui-flashcard-word">{inline(value)}</span> : renderSlot(value, renderNode));
    return (
      <button type="button" className={cx("iui-flashcard", flipped && "is-flipped")} aria-pressed={flipped} onClick={() => setFlipped(!flipped)}>
        <span className="iui-flashcard-inner">
          <span className="iui-flashcard-face is-front" aria-hidden={flipped}>
            {face(props.front)}
            <span className="iui-flashcard-hint">{str(props.hint) || text.tapToFlip}</span>
          </span>
          <span className="iui-flashcard-face is-back" aria-hidden={!flipped}>
            {face(props.back)}
          </span>
        </span>
      </button>
    );
  },
});
