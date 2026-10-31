// Photo lookups for SearchImage, run in the browser against Wikipedia and Wikimedia Commons.
// The upstream demo runs the same lookups on its own server; DSH has no route for them, and both
// APIs answer anonymous cross-origin requests (`origin=*` on the Action API). Only these fixed
// hosts are contacted, and only https image addresses they return are used.

const SKIP = /\.svg|icon|logo|map|flag|seal|coat_of_arms|signature|diagram/i;
const WIDTH = 960;
const TIMEOUT_MS = 8000;

type Page = { index?: number; title?: string; thumbnail?: { source?: string }; imageinfo?: { thumburl?: string; url?: string; mime?: string }[] };
type Summary = { thumbnail?: { source?: string } };
type Media = { items?: { type?: string; srcset?: { src: string }[] }[] };

/** Chinese and Japanese queries look up their own Wikipedia first; everything else uses English. */
function wikiHost(query: string): string {
  if (/[぀-ヿ]/.test(query)) return "ja.wikipedia.org";
  if (/[一-鿿]/.test(query)) return "zh.wikipedia.org";
  return "en.wikipedia.org";
}

async function getJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(TIMEOUT_MS) });
  // A missing article is a real answer; any other failure is retried next time.
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`lookup ${response.status}`);
  return (await response.json()) as T;
}

async function query(host: string, params: Record<string, string>): Promise<Page[]> {
  const search = new URLSearchParams({ action: "query", format: "json", formatversion: "2", origin: "*", ...params });
  const data = await getJson<{ error?: unknown; query?: { pages?: Page[] } }>(`https://${host}/w/api.php?${search}`);
  // A rate limit comes back as 200 with an error body: throw so "no photos" is not cached.
  if (data?.error) throw new Error(`${host} error`);
  return (data?.query?.pages ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

const https = (url: string) => (url.startsWith("//") ? `https:${url}` : url);
/** Only https photo addresses, never logos, maps or diagrams. */
const usable = (url: string | null): url is string => !!url && url.startsWith("https://") && !SKIP.test(url);
const fileKey = (url: string) => decodeURIComponent(url.split("?")[0].split("/").slice(-1)[0]).replace(/^\d+px-/, "");

/** The article titled like the query: its lead image, then up to two more photos. */
async function articlePhotos(title: string): Promise<string[]> {
  const host = wikiHost(title);
  const t = encodeURIComponent(title.replace(/ /g, "_"));
  const [summary, media] = await Promise.all([
    getJson<Summary>(`https://${host}/api/rest_v1/page/summary/${t}`),
    getJson<Media>(`https://${host}/api/rest_v1/page/media-list/${t}`),
  ]);
  const photos: string[] = [];
  // A lead image can be a logo or a map (an SVG rendered as PNG); those are not photos.
  const lead = summary?.thumbnail?.source ? https(summary.thumbnail.source) : null;
  if (usable(lead)) photos.push(lead);
  for (const item of media?.items ?? []) {
    if (item.type !== "image" || !item.srcset?.length) continue;
    const url = https(item.srcset[0].src);
    if (!usable(url)) continue;
    if (!photos.some((p) => fileKey(p) === fileKey(url))) photos.push(url);
    if (photos.length >= 3) break;
  }
  return photos;
}

// Words that say what the photo shows; an article must share one with the query.
const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3 || /[^\x00-\x7f]/.test(w));

/** Matching Wikipedia lead images, then Commons files, dropping trailing words when a long description finds nothing. */
async function searchPhotos(q: string): Promise<string[]> {
  const images: string[] = [];
  const add = (url: string | undefined) => {
    if (url && usable(url) && !images.includes(url)) images.push(url);
  };
  const wanted = new Set(words(q));
  const articles = await query(wikiHost(q), { generator: "search", gsrsearch: q, gsrlimit: "6", prop: "pageimages", piprop: "thumbnail", pithumbsize: String(WIDTH) });
  articles.filter((page) => words(page.title ?? "").some((w) => wanted.has(w))).forEach((page) => add(page.thumbnail?.source));
  const terms = q.split(/\s+/);
  const tries = [...new Set([terms.join(" "), terms.slice(0, 3).join(" "), terms.slice(0, 2).join(" ")])];
  for (const t of tries) {
    if (images.length >= 3) break;
    const files = await query("commons.wikimedia.org", { generator: "search", gsrsearch: `${t} filetype:bitmap`, gsrnamespace: "6", gsrlimit: "6", prop: "imageinfo", iiprop: "url|mime", iiurlwidth: String(WIDTH) });
    files.forEach((page) => {
      const info = page.imageinfo?.[0];
      if (info?.mime?.startsWith("image/")) add(info.thumburl ?? info.url);
    });
  }
  return images.slice(0, 4);
}

const searches = new Map<string, Promise<string[]>>();

/**
 * Photo URLs for a query: the article with that exact title first (right for a named place, dish or
 * product), then a Wikipedia and Commons search. Results are kept for the page's lifetime; failures
 * are retried next time.
 * @param raw - The model-written query.
 * @returns Up to seven https image addresses, best first.
 */
export function searchImages(raw: string): Promise<string[]> {
  const q = raw.replace(/\s+/g, " ").trim().slice(0, 200);
  let request = searches.get(q);
  if (!request) {
    request = Promise.all([articlePhotos(q).catch((): string[] => []), searchPhotos(q).catch((): string[] => [])]).then(([exact, found]) => {
      const all = [...new Set([...exact, ...found])];
      if (!all.length) searches.delete(q);
      return all;
    });
    if (searches.size > 200) searches.delete(searches.keys().next().value ?? q);
    searches.set(q, request);
  }
  return request;
}
