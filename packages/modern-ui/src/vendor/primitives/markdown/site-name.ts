/**
 * Display names for citation sources, derived from the source URL alone so that
 * rendering a citation never issues a favicon or other network request.
 */

/**
 * Host suffix to brand name. A host matches a suffix when it equals it or is a
 * subdomain of it, and the longest matching suffix wins, so `mp.weixin.qq.com`
 * keeps its own entry while `qq.com` names everything else under that domain.
 */
const SITE_BRANDS: ReadonlyMap<string, string> = new Map(Object.entries({
  'github.com': 'GitHub',
  'githubusercontent.com': 'GitHub',
  'gitlab.com': 'GitLab',
  'bitbucket.org': 'Bitbucket',
  'stackoverflow.com': 'Stack Overflow',
  'stackexchange.com': 'Stack Exchange',
  'npmjs.com': 'npm',
  'pypi.org': 'PyPI',
  'docs.rs': 'docs.rs',
  'pkg.go.dev': 'Go Packages',
  'go.dev': 'Go',
  'golang.org': 'Go',
  'rust-lang.org': 'Rust',
  'python.org': 'Python',
  'docs.python.org': 'Python Docs',
  'nodejs.org': 'Node.js',
  'typescriptlang.org': 'TypeScript',
  'react.dev': 'React',
  'vuejs.org': 'Vue',
  'kubernetes.io': 'Kubernetes',
  'docker.com': 'Docker',
  'developer.mozilla.org': 'MDN',
  'developer.apple.com': 'Apple Developer',
  'developer.android.com': 'Android Developers',
  'developer.chrome.com': 'Chrome for Developers',
  'developers.google.com': 'Google Developers',
  'learn.microsoft.com': 'Microsoft Learn',
  'azure.microsoft.com': 'Azure',
  'cloud.google.com': 'Google Cloud',
  'aws.amazon.com': 'AWS',
  'docs.aws.amazon.com': 'AWS Docs',
  'huggingface.co': 'Hugging Face',
  'openai.com': 'OpenAI',
  'anthropic.com': 'Anthropic',
  'arxiv.org': 'arXiv',
  'news.ycombinator.com': 'Hacker News',
  'medium.com': 'Medium',
  'dev.to': 'DEV',
  'substack.com': 'Substack',
  'wikipedia.org': 'Wikipedia',
  'wikimedia.org': 'Wikimedia',
  'youtube.com': 'YouTube',
  'youtu.be': 'YouTube',
  'x.com': 'X',
  'twitter.com': 'X',
  'reddit.com': 'Reddit',
  'linkedin.com': 'LinkedIn',
  'facebook.com': 'Facebook',
  'instagram.com': 'Instagram',
  'tiktok.com': 'TikTok',
  'quora.com': 'Quora',
  'notion.so': 'Notion',
  'notion.site': 'Notion',
  'slack.com': 'Slack',
  'google.com': 'Google',
  'docs.google.com': 'Google Docs',
  'drive.google.com': 'Google Drive',
  'scholar.google.com': 'Google Scholar',
  'bing.com': 'Bing',
  'duckduckgo.com': 'DuckDuckGo',
  'apple.com': 'Apple',
  'amazon.com': 'Amazon',
  'ebay.com': 'eBay',
  'airbnb.com': 'Airbnb',
  'booking.com': 'Booking.com',
  'tripadvisor.com': 'Tripadvisor',
  'imdb.com': 'IMDb',
  'bbc.com': 'BBC',
  'bbc.co.uk': 'BBC',
  'cnn.com': 'CNN',
  'reuters.com': 'Reuters',
  'bloomberg.com': 'Bloomberg',
  'nytimes.com': 'The New York Times',
  'washingtonpost.com': 'The Washington Post',
  'wsj.com': 'The Wall Street Journal',
  'ft.com': 'Financial Times',
  'theguardian.com': 'The Guardian',
  'economist.com': 'The Economist',
  'forbes.com': 'Forbes',
  'techcrunch.com': 'TechCrunch',
  'theverge.com': 'The Verge',
  'wired.com': 'WIRED',
  'arstechnica.com': 'Ars Technica',
  'nature.com': 'Nature',
  'science.org': 'Science',
  'sciencedirect.com': 'ScienceDirect',
  'ieee.org': 'IEEE',
  'acm.org': 'ACM',
  'nih.gov': 'NIH',
  'pubmed.ncbi.nlm.nih.gov': 'PubMed',
  'who.int': 'WHO',
  'semanticscholar.org': 'Semantic Scholar',
  'researchgate.net': 'ResearchGate',
  'zhihu.com': '知乎',
  'bilibili.com': '哔哩哔哩',
  'weibo.com': '微博',
  'baidu.com': '百度',
  'baike.baidu.com': '百度百科',
  'zhidao.baidu.com': '百度知道',
  'csdn.net': 'CSDN',
  'juejin.cn': '稀土掘金',
  'sina.com.cn': '新浪',
  'qq.com': '腾讯',
  'mp.weixin.qq.com': '微信公众平台',
  '163.com': '网易',
  'weather.com.cn': '中国天气网',
  'taobao.com': '淘宝',
  'tmall.com': '天猫',
  'jd.com': '京东',
  'douban.com': '豆瓣',
  'xiaohongshu.com': '小红书',
  'douyin.com': '抖音',
  'sohu.com': '搜狐',
  'ifeng.com': '凤凰网',
  'cnblogs.com': '博客园',
  'segmentfault.com': 'SegmentFault',
  'oschina.net': '开源中国',
  '36kr.com': '36氪',
  'sspai.com': '少数派',
  'ithome.com': 'IT之家',
  'people.com.cn': '人民网',
  'xinhuanet.com': '新华网',
  'cnki.net': '知网',
  'v2ex.com': 'V2EX',
  'yahoo.co.jp': 'Yahoo! JAPAN',
  'naver.com': 'NAVER',
  'yandex.ru': 'Yandex',
}))

/**
 * Hosting platforms that give every site its own first label (`project.github.io`).
 * Such a host is named by that label, since the platform name would not tell sources apart.
 */
const TENANT_HOSTS: readonly string[] = [
  'github.io', 'gitlab.io', 'readthedocs.io', 'readthedocs.org', 'netlify.app', 'vercel.app', 'pages.dev',
  'web.app', 'firebaseapp.com', 'herokuapp.com', 'blogspot.com', 'wordpress.com', 'fly.dev', 'onrender.com', 'surge.sh',
]

/** Second-level registries under a country code: the registrable domain then spans three labels. */
const COMPOUND_SUFFIXES: ReadonlySet<string> = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'com.hk', 'com.tw',
  'com.au', 'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'co.kr', 'com.br', 'com.sg', 'co.nz', 'co.in', 'co.za', 'com.mx',
])

const IPV4_HOST = /^\d{1,3}(?:\.\d{1,3}){3}$/

/** Longest chip name before it is cut with an ellipsis, in code points. */
const CHIP_NAME_LIMIT = 24

function parseHost(href: string): URL | undefined {
  try { return new URL(href) }
  catch { return undefined } // An unparseable destination has no host to name.
}

/**
 * Name the site an external source URL belongs to.
 * @param href - Absolute HTTP(S) source URL; `www.` and a trailing root dot are ignored.
 * @returns A known brand name, the tenant label of a hosting platform, or else the registrable domain
 * (`docs.example.co.uk` gives `example.co.uk`); IP addresses and single-label hosts are returned as written,
 * and an unparseable value is returned unchanged.
 */
export function citationSiteName(href: string): string {
  const url = parseHost(href)
  if (url === undefined) return href
  const host = url.hostname.replace(/^www\./u, '').replace(/\.$/u, '')
  const labels = host.split('.')
  for (let start = 0; start < labels.length; start += 1) {
    const brand = SITE_BRANDS.get(labels.slice(start).join('.'))
    if (brand !== undefined) return brand
  }
  const tenant = TENANT_HOSTS.find(suffix => host.endsWith(`.${suffix}`))
  if (tenant !== undefined) {
    const tenantHost = host.slice(0, -(tenant.length + 1))
    return tenantHost.slice(tenantHost.lastIndexOf('.') + 1)
  }
  if (labels.length < 2 || IPV4_HOST.test(host) || host.startsWith('[')) return host
  const compound = COMPOUND_SUFFIXES.has(labels.slice(-2).join('.')) ? 3 : 2
  return labels.slice(-compound).join('.')
}

/**
 * Show where a source lives without its query or fragment.
 * @param href - Absolute HTTP(S) source URL.
 * @returns The host with port, followed by the path unless it is the bare root; an unparseable value is returned unchanged.
 */
export function citationLocation(href: string): string {
  const url = parseHost(href)
  if (url === undefined) return href
  return url.pathname === '/' ? url.host : `${url.host}${url.pathname}`
}

/**
 * Pick the single character that stands in for a site mark.
 * @param name - A site name from {@link citationSiteName}.
 * @returns The first code point, upper-cased, or `?` for an empty name.
 */
export function citationGlyph(name: string): string {
  const [first = '?'] = Array.from(name)
  return first.toUpperCase()
}

/**
 * Shorten a site name for an inline chip so a long domain cannot widen a line.
 * @param name - A site name from {@link citationSiteName}.
 * @returns The name, or its first 23 code points followed by an ellipsis when it exceeds 24.
 */
export function citationChipName(name: string): string {
  const characters = Array.from(name)
  return characters.length <= CHIP_NAME_LIMIT ? name : `${characters.slice(0, CHIP_NAME_LIMIT - 1).join('')}…`
}
