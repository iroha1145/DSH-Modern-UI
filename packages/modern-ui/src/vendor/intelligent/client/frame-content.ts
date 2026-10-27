/** Fixed sandbox document and safe data-to-script serialization. */
import { defaultHostStyle, frameStyles, type HostStyle } from './design-system.ts'
import { MAX_HEIGHT, type IntelligentContent } from './schema.ts'

/** Messages are accepted only from the exact mounted frame window. */
export const FRAME_EVENT_TYPE = 'dsh:intelligent-ui:v1'

/** No network, external scripts, evaluation, forms, nested frames, plugins, or workers. */
export const FRAME_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; media-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; manifest-src 'none'"

function scriptData(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

/**
 * Build the inner document with policy before generated content.
 * @returns A constant HTML shell containing no model-authored markup.
 */
export function frameDocument(): string {
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="dsh-visual"></main></body></html>`
}

/**
 * Build one inline program; HTML, CSS, and JavaScript remain string data until inside the opaque-origin frame.
 * @param content - Validated completed content.
 * @param token - Per-mount message token.
 * @param scheme - Current resolved application palette, scoped to this frame.
 * @param host - Allowlisted chat typography and colors for the frame design system.
 * @param icons - Fixed icon geometry for the names this content mentions.
 * @returns Trusted initialization followed by model-authored scripts inside the sandbox.
 */
export function frameProgram(
  content: IntelligentContent, token: string, scheme: 'light' | 'dark' = 'light',
  host: HostStyle = defaultHostStyle(scheme), icons: Readonly<Record<string, string>> = {},
): string {
  const html = Array.isArray(content.html) ? content.html.join('') : content.html
  const expressions = Array.isArray(content.jsExpressions) ? content.jsExpressions : [content.jsExpressions ?? '']
  return `(() => {
    const kind = ${scriptData(FRAME_EVENT_TYPE)};
    const token = ${scriptData(token)};
    const emit = (state, extra = {}) => parent.postMessage({type: kind, token, state, ...extra}, '*');
    const icons = ${scriptData(icons)};
    const iconMarkup = name => Object.hasOwn(icons, name) ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[name] + '</svg>' : '';
    const paintIcons = () => {
      for (const node of document.querySelectorAll('[data-icon]')) {
        const name = node.getAttribute('data-icon');
        if (node.dshIcon === name || !Object.hasOwn(icons, name)) continue;
        node.dshIcon = name;
        node.innerHTML = iconMarkup(name);
        if (!node.hasAttribute('aria-label')) node.setAttribute('aria-hidden', 'true');
      }
    };
    const start = event => {
      if(event.source !== parent || !event.data || event.data.type !== kind || event.data.token !== token || event.data.state !== 'start') return;
      removeEventListener('message', start);
    addEventListener('error', event => { event.preventDefault(); emit('error'); });
    addEventListener('unhandledrejection', event => { event.preventDefault(); emit('error'); });
    addEventListener('click', event => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href],area[href]') : null;
      if (anchor === null) return;
      event.preventDefault();
      if (/^https?:/i.test(anchor.href)) emit('open', {href: anchor.href});
    }, true);
    const styles = document.createElement('style');
    styles.textContent = ${scriptData(frameStyles(scheme, host))};
    document.head.appendChild(styles);
    const authoredStyle = document.createElement('style');
    authoredStyle.textContent = ${scriptData(content.css ?? '')};
    document.head.appendChild(authoredStyle);
    const template = document.createElement('template');
    template.innerHTML = ${scriptData(html)};
    template.content.querySelectorAll('meta,base,script,link,iframe,object,embed').forEach(node => node.remove());
    const root = document.getElementById('dsh-visual');
    root.appendChild(template.content);
    paintIcons();
    new MutationObserver(paintIcons).observe(root, {childList: true, subtree: true, attributes: true, attributeFilter: ['data-icon']});
    window.dshIcon = iconMarkup;
    // Measure authored content, never the viewport-sized document scrollHeight.
    // This keeps both shrinkage and the capped, internally scrollable case stable.
    let lastHeight;
    const measure = () => {
      const bodyStyle = getComputedStyle(document.body);
      const authored = Math.max(root.scrollHeight, root.getBoundingClientRect().height)
        + parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom);
      // A script may add content beside #dsh-visual; the body's own height wraps all of it.
      const height = Math.ceil(Math.max(authored, document.body.getBoundingClientRect().height));
      // Scroll only past the cap, so a frame growing into its height never flashes a scrollbar.
      document.documentElement.style.overflowY = height > ${MAX_HEIGHT} ? 'auto' : 'hidden';
      if (height === lastHeight) return;
      lastHeight = height;
      emit('resize', {height});
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(document.body);
    addEventListener('pagehide', () => observer.disconnect(), {once:true});
    for (const text of ${scriptData([content.jsFunctions ?? '', ...expressions])}) {
      if (!text.trim()) continue;
      const script = document.createElement('script');
      script.textContent = text;
      document.head.appendChild(script);
    }
    measure();
    emit('ready');
    };
    addEventListener('message', start);
  })();`
}
