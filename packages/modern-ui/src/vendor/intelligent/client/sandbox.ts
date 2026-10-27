/** Native nested sandboxes: trusted outer policy contains navigation by the generated inner frame. */
import { defaultHostStyle, type HostStyle } from './design-system.ts'
import { FRAME_CSP, FRAME_EVENT_TYPE, frameDocument, frameProgram } from './frame-content.ts'
import { MAX_HEIGHT, MIN_HEIGHT, reportedHeight, type IntelligentContent } from './schema.ts'

/** Local mount events contain no model or host-service actions. */
export interface FrameCallbacks {
  ready(): void
  /** The frame missed its deadline or navigated away; it has been removed. */
  failed(): void
  /** An authored script threw; the frame stays mounted with whatever it rendered. */
  scriptError(): void
  resized(height: number): void
  /** An untrusted frame requests an HTTP(S) link; the host must obtain its own confirmation. */
  openLink(href: string): void
}

/** Presentation inputs that the page supplies to one frame. */
export interface FrameOptions {
  readonly scheme?: 'light' | 'dark'
  readonly host?: HostStyle
  readonly icons?: Readonly<Record<string, string>>
}

const LINK_LIMIT = 2048

function scriptData(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

/**
 * Build a fixed outer program with one data-only inner document and no code-message or host API receiver.
 * @param content - Validated completed content.
 * @param token - Per-mount display message token.
 * @param options - Palette, chat typography, and icon geometry for this frame.
 * @returns The trusted policy container's complete document.
 */
export function outerDocument(content: IntelligentContent, token: string, options: FrameOptions = {}): string {
  const scheme = options.scheme ?? 'light'
  const program = frameProgram(content, token, scheme, options.host ?? defaultHostStyle(scheme), options.icons ?? {})
  // A replacer function keeps `$$`, `$&`, and `$'` in authored code literal; a replacement string expands them.
  const innerDocument = frameDocument().replace('</body>', () => `<script>${program}</script></body>`)
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent;color-scheme:${scheme}}iframe{display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:inherit}</style></head><body><script>(()=>{
    const token=${scriptData(token)};
    const kind=${scriptData(FRAME_EVENT_TYPE)};
    const inner=document.createElement('iframe');
    inner.setAttribute('sandbox','allow-scripts');
    inner.referrerPolicy='no-referrer';
    inner.title=${scriptData(content.title)};
    inner.setAttribute('allow',${scriptData(DENIED_PERMISSIONS)});
    let started = false;
    inner.addEventListener('load', () => {
      if(started) { parent.postMessage({type:kind,token,state:'failed'},'*'); return; }
      started = true;
      inner.contentWindow.postMessage({type:kind,token,state:'start'},'*');
    });
    addEventListener('message',event=>{
      if(event.source!==inner.contentWindow)return;
      const data=event.data;
      if(!data||typeof data!=='object'||data.type!==kind||data.token!==token)return;
      if(data.state==='resize'){
        if(typeof data.height!=='number'||!Number.isFinite(data.height))return;
        parent.postMessage({type:kind,token,state:'resize',height:Math.min(${MAX_HEIGHT},Math.max(${MIN_HEIGHT},Math.ceil(data.height)))},'*');
      }else if(data.state==='open'){
        if(typeof data.href!=='string'||data.href.length>${LINK_LIMIT}||!/^https?:/i.test(data.href))return;
        parent.postMessage({type:kind,token,state:'open',href:data.href},'*');
      }else if(data.state==='error'||data.state==='ready'){
        parent.postMessage({type:kind,token,state:data.state},'*');
      }
    });
    inner.srcdoc=${scriptData(innerDocument)};
    document.body.appendChild(inner);
  })();</script></body></html>`
}

const DENIED_PERMISSIONS = "accelerometer 'none'; autoplay 'none'; camera 'none'; clipboard-read 'none'; clipboard-write 'none'; display-capture 'none'; encrypted-media 'none'; fullscreen 'none'; geolocation 'none'; gyroscope 'none'; hid 'none'; microphone 'none'; midi 'none'; payment 'none'; picture-in-picture 'none'; publickey-credentials-get 'none'; screen-wake-lock 'none'; serial 'none'; usb 'none'; web-share 'none'; xr-spatial-tracking 'none'"

// crypto.getRandomValues stays available on plain-HTTP LAN pages, where crypto.randomUUID is withheld.
function messageToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
}

function linkTarget(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > LINK_LIMIT) return undefined
  try {
    const url = new URL(value)
    // A user part reads as the site: https://docs.python.org@evil.example/ goes to evil.example.
    if (url.username !== '' || url.password !== '') return undefined
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch (_error) {
    // A malformed address from the frame is ignored; the click already stayed inside the sandbox.
    return undefined
  }
}

/**
 * Mount one completed visualization and return its complete resource disposer.
 * @param container - This instance's empty frame container.
 * @param content - Validated model-authored content.
 * @param callbacks - Local display state, bounded layout updates, and reader link clicks.
 * @param options - Palette, chat typography, and icon geometry for this frame.
 * @returns Disposer for the timeout, message listener, and both nested frames.
 */
export function mountVisualization(
  container: Element, content: IntelligentContent, callbacks: FrameCallbacks, options: FrameOptions = {},
): () => void {
  const frame = document.createElement('iframe')
  const token = messageToken()
  let disposed = false
  let failed = false
  let scriptFailed = false
  const fail = (): void => {
    if (disposed || failed) return
    failed = true
    clearTimeout(timeout)
    frame.remove()
    callbacks.failed()
  }
  const timeout = window.setTimeout(fail, 15_000)
  const onMessage = (event: MessageEvent<unknown>): void => {
    if (disposed || failed || event.source !== frame.contentWindow) return
    const data = event.data
    if (data === null || typeof data !== 'object' || !('type' in data) || data.type !== FRAME_EVENT_TYPE
      || !('token' in data) || data.token !== token || !('state' in data)) return
    if (data.state === 'failed') fail()
    else if (data.state === 'error') {
      if (scriptFailed) return
      scriptFailed = true
      callbacks.scriptError()
    } else if (data.state === 'ready') {
      clearTimeout(timeout)
      callbacks.ready()
    } else if (data.state === 'resize' && 'height' in data) {
      const height = reportedHeight(data.height)
      if (height !== undefined) callbacks.resized(height)
    } else if (data.state === 'open' && 'href' in data) {
      const href = linkTarget(data.href)
      if (href !== undefined) callbacks.openLink(href)
    }
  }
  window.addEventListener('message', onMessage)
  frame.title = content.title
  frame.referrerPolicy = 'no-referrer'
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.setAttribute('allow', DENIED_PERMISSIONS)
  // A matching color scheme on the embedding element keeps the frame canvas transparent.
  frame.style.colorScheme = options.scheme ?? 'light'
  frame.srcdoc = outerDocument(content, token, options)
  container.appendChild(frame)
  return () => {
    disposed = true
    clearTimeout(timeout)
    window.removeEventListener('message', onMessage)
    frame.remove()
  }
}
