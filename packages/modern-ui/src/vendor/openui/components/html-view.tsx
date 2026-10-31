import { defineComponent, useIsStreaming } from "@openuidev/react-lang";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod/v4";
import { useColorScheme } from "./scheme";
import { useUiText } from "./ui-text";

// Two nested sandboxed frames, both scripts-only with an opaque origin (no access to DSH, its
// cookies or storage, no forms, popups or top navigation). The model's page runs in the inner
// frame with no network at all. The outer frame holds only fixed code; its policy also governs
// where the inner frame may navigate, so a script that sets location cannot reach any address.
const INNER_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");
// The inner srcdoc frame inherits this policy on top of its own, so it allows the same non-network sources.
const OUTER_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; frame-src 'none'; child-src 'none'; form-action 'none'; base-uri 'none'";
const DENIED =
  "accelerometer 'none'; autoplay 'none'; camera 'none'; clipboard-read 'none'; clipboard-write 'none'; display-capture 'none'; fullscreen 'none'; geolocation 'none'; gyroscope 'none'; microphone 'none'; midi 'none'; payment 'none'; usb 'none'; xr-spatial-tracking 'none'";

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 2400;
const AUTO_START = 360;
const KIND = "dsh:openui-html-view:v1";
const COLOR = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\([\w\s.,%/+-]{1,80}\))$/i;

const data = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

// CSP has no directive for WebRTC, so its constructors are removed before authored code runs. This is
// best effort: a script that builds a fresh frame can still reach them.
const NO_WEBRTC = `<script>(function(){for(const k of ["RTCPeerConnection","webkitRTCPeerConnection","RTCDataChannel","RTCRtpSender","RTCRtpReceiver","RTCIceTransport"]){try{Object.defineProperty(window,k,{value:undefined,writable:false,configurable:false})}catch(e){}}})()</script>`;

// Reports the content height to the outer frame, which forwards it.
const REPORTER = `<script>(function(){var last=0;function send(){var h=Math.ceil(document.documentElement.getBoundingClientRect().height);if(Math.abs(h-last)>1){last=h;parent.postMessage({type:"${KIND}",height:h},"*")}}addEventListener("load",send);new ResizeObserver(send).observe(document.documentElement);send()})()</script>`;

type Palette = { fg: string; bg: string; muted: string; line: string; accent: string };

function innerDocument(html: string, scheme: "light" | "dark", palette: Palette) {
  const vars = `--fg:${palette.fg};--bg:${palette.bg};--muted:${palette.muted};--line:${palette.line};--accent:${palette.accent}`;
  // The policy comes first, so it covers everything in the model's markup.
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${INNER_CSP}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{color-scheme:${scheme};${vars}}html,body{margin:0;background:transparent;color:var(--fg)}body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}</style>${NO_WEBRTC}${REPORTER}${html}`;
}

function outerDocument(inner: string, token: string, title: string) {
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${OUTER_CSP}"><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}iframe{display:block;width:100%;height:100%;border:0;background:transparent}</style></head><body><script>(()=>{
const kind=${data(KIND)},token=${data(token)};
const frame=document.createElement('iframe');
frame.setAttribute('sandbox','allow-scripts');
frame.setAttribute('allow',${data(DENIED)});
frame.referrerPolicy='no-referrer';
frame.title=${data(title)};
let loads=0;
frame.addEventListener('load',()=>{if(++loads>1)parent.postMessage({type:kind,token,state:'failed'},'*');});
addEventListener('message',event=>{
  if(event.source!==frame.contentWindow)return;
  const d=event.data;
  if(!d||d.type!==kind||typeof d.height!=='number'||!Number.isFinite(d.height))return;
  parent.postMessage({type:kind,token,height:d.height},'*');
});
frame.srcdoc=${data(inner)};
document.body.appendChild(frame);
})();</script></body></html>`;
}

// crypto.getRandomValues stays available on plain-HTTP LAN pages, where crypto.randomUUID is withheld.
const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

function readPalette(element: HTMLElement | null): Palette {
  // Tokens such as --iui-border-strong are color-mix() expressions; a probe's computed color resolves them.
  const probe = element ? element.appendChild(document.createElement("span")) : null;
  const pick = (name: string, fallback: string) => {
    if (!probe) return fallback;
    probe.style.color = `var(${name})`;
    const value = getComputedStyle(probe).color.trim();
    return COLOR.test(value) ? value : fallback;
  };
  try {
    return {
      fg: pick("--iui-ink", "#171717"),
      bg: pick("--iui-canvas", "#ffffff"),
      muted: pick("--iui-muted", "#5b5b5b"),
      line: pick("--iui-border-strong", "#d9d9d9"),
      accent: pick("--iui-chart-1", "#0285ff"),
    };
  } finally {
    probe?.remove();
  }
}

export const HtmlView = defineComponent({
  name: "HtmlView",
  props: z.object({
    html: z.string(),
    height: z.number().optional(),
    title: z.string().optional(),
  }),
  description:
    "Sandboxed HTML page with inline JS, for a game, canvas or animation the other components cannot express. No network, libraries, external fonts or images (inline SVG and data: URLs only). Colors: CSS variables --fg, --muted, --line, --bg and --accent. Build the page with DOM methods; navigating or document.write ends the view. Fits its content unless height is set.",
  component: function HtmlViewView({ props }) {
    const text = useUiText();
    const streaming = useIsStreaming();
    const frame = useRef<HTMLIFrameElement>(null);
    const box = useRef<HTMLDivElement>(null);
    const scheme = useColorScheme(box);
    const fixed = typeof props.height === "number" && props.height > 0 ? Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, props.height)) : null;
    const [measured, setMeasured] = useState<number | null>(null);
    const [failed, setFailed] = useState(false);
    const html = typeof props.html === "string" ? props.html : "";
    const title = props.title || text.interactiveView;
    const token = useMemo(newToken, []);
    const [palette, setPalette] = useState<Palette | null>(null);
    useEffect(() => {
      setPalette(readPalette(box.current));
    }, [scheme]);
    const srcDoc = useMemo(() => (palette ? outerDocument(innerDocument(html, scheme, palette), token, title) : null), [html, scheme, palette, token, title]);

    useEffect(() => {
      const onMessage = (event: MessageEvent) => {
        if (event.source !== frame.current?.contentWindow) return;
        const message = event.data as { type?: unknown; token?: unknown; height?: unknown; state?: unknown };
        if (message?.type !== KIND || message.token !== token) return;
        if (message.state === "failed") setFailed(true);
        else if (!fixed && typeof message.height === "number" && Number.isFinite(message.height)) setMeasured(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(message.height))));
      };
      window.addEventListener("message", onMessage);
      return () => window.removeEventListener("message", onMessage);
    }, [fixed, token]);

    // A page that is still streaming would reload on every chunk; it runs once complete.
    const height = fixed ?? measured ?? AUTO_START;
    return (
      <div ref={box} className="iui-html-view" style={{ height: failed ? undefined : height }}>
        {failed ? (
          <div className="iui-html-view-wait">{text.viewStopped}</div>
        ) : streaming || !srcDoc ? (
          <div className="iui-html-view-wait">{text.preparingView}</div>
        ) : (
          <iframe ref={frame} title={title} sandbox="allow-scripts" allow={DENIED} srcDoc={srcDoc} referrerPolicy="no-referrer" />
        )}
      </div>
    );
  },
});
