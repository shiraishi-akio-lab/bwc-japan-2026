// 公開情報を読む。見本サイトも実在のサイトも、ここの1本の経路を通る。
// 違うのは「どこから取るか」（makeOpener）だけ：アプリ内の見本は ASSETS、それ以外は検査つきの fetch。
// fetch を差し替えられる形にしてあるので、転送や上限は Node からも試せる（scripts/demo-check.ts）。

export const SITE_LIMITS = {
  pages: 12,          // 1回に読むページ数（トップを含む）
  sections: 4,        // トップからたどる入口の数
  perSection: 4,      // 入口1つからたどるページの数
  bytes: 500_000,     // 1ページの大きさ
  redirects: 3,       // 転送の段数
  timeoutMs: 5_000,   // 1ページ
  totalMs: 25_000,    // 1回全体
  chars: 3_000,       // Claude に渡す1ページの字数
};

const SAMPLE_PREFIX = "/sample-site/";
const SAMPLE_MARK = 'name="sample-site"'; // ASSETS は無いパスにも SPA の殻を 200 で返すので、印の無いページは「無い」扱い
const USER_AGENT = "EigyoGymReader/0.1";

// 利用者に見せてよい理由つきの失敗
export class SiteError extends Error {}

export type Page = { url: string; title: string; text: string; date: string };
type Parsed = Omit<Page, "url"> & { links: { href: string; text: string }[] };
export type Opener = (url: URL, signal: AbortSignal) => Promise<Response>;

// ---- 接続してよい相手か ----

const ipv4Parts = (host: string) => {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return m ? m.slice(1).map(Number) : null;
};

const ipv4Blocked = ([a, b, c]: number[]) =>
  a === 0 || a === 10 || a === 127 || a >= 224 ||
  (a === 100 && b >= 64 && b <= 127) ||  // 共有アドレス（クラウドのメタデータもここにある）
  (a === 169 && b === 254) ||            // リンクローカル・メタデータ
  (a === 168 && b === 63 && c === 129) ||
  (a === 172 && b >= 16 && b <= 31) ||
  (a === 192 && b === 168) ||
  (a === 192 && b === 0 && (c === 0 || c === 2)) ||
  (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
  (a === 203 && b === 0 && c === 113);

const ipv6Groups = (host: string) => {
  const [head, tail] = host.split("::");
  const part = (s?: string) => (s ? s.split(":").map((g) => parseInt(g, 16)) : []);
  const a = part(head);
  const b = part(tail);
  return host.includes("::") ? [...a, ...Array(8 - a.length - b.length).fill(0), ...b] : a;
};

// 公開の範囲（2000::/3）だけを通す。v4 を包んだ形（::ffff:、6to4 など）も通さない
const ipv6Blocked = (host: string) => {
  const g = ipv6Groups(host);
  return g.length !== 8 || g.some(Number.isNaN) || (g[0] & 0xe000) !== 0x2000 || g[0] === 0x2002 || (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8));
};

export const isBlockedAddress = (address: string) => {
  const v4 = ipv4Parts(address);
  if (v4) return ipv4Blocked(v4);
  return address.includes(":") ? ipv6Blocked(address) : false;
};

const LOCAL_NAME = /(^|\.)(localhost|local|internal|intranet|lan|corp|home\.arpa)$/;

const isBlockedHost = (hostname: string) => {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[")) return isBlockedAddress(host.slice(1, -1));
  if (ipv4Parts(host)) return isBlockedAddress(host);
  return !host.includes(".") || LOCAL_NAME.test(host);
};

// URL の字面の検査。IP の書き換え（10進・16進など）は new URL が正規化してから見る
export function assertPublicUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SiteError("http か https の URL を入れてください");
  if (url.username || url.password) throw new SiteError("認証情報の入った URL は読みません");
  if (url.port && url.port !== "80" && url.port !== "443") throw new SiteError("通常のポート以外は読みません");
  if (isBlockedHost(url.hostname)) throw new SiteError("社内や手元のアドレスには接続しません");
}

// 画面の入力を URL にする。"/sample-site/…" はアプリ内の見本
export function resolveInput(raw: string, appOrigin: string): URL {
  const s = raw.trim();
  try {
    if (s.startsWith("/") && !s.startsWith("//")) return new URL(s, appOrigin);
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
  } catch {
    throw new SiteError("URL の形が正しくありません");
  }
}

// 名前の解決先も見る（名前がプライベートIPを指す場合）。確かめられなければ接続しない
type Resolver = (host: string) => Promise<string[]>;
const dohResolve: Resolver = async (host) => {
  const answers = await Promise.all(["A", "AAAA"].map(async (type) => {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(SITE_LIMITS.timeoutMs),
    });
    if (!r.ok) throw new SiteError("接続先を確かめられませんでした");
    const { Answer = [] } = (await r.json()) as { Answer?: { type: number; data: string }[] };
    return Answer.filter((a) => a.type === 1 || a.type === 28).map((a) => a.data);
  }));
  return answers.flat();
};

export const isSamplePage = (url: URL, appOrigin: string) => url.origin === appOrigin && url.pathname.startsWith(SAMPLE_PREFIX);

type OpenerDeps = {
  appOrigin: string;
  assets: Pick<Fetcher, "fetch">;
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
  resolve?: Resolver;
};

// 自分のオリジンの判定を、接続先の検査より先に置く（手元のアプリ自身は 127.0.0.1 や localhost なので）
export const makeOpener = ({ appOrigin, assets, fetcher = (u, i) => fetch(u, i), resolve = dohResolve }: OpenerDeps): Opener => async (url, signal) => {
  if (isSamplePage(url, appOrigin)) {
    const res = await assets.fetch(new Request(url, { redirect: "manual", signal }));
    if (!res.ok) return res;
    const html = await res.clone().text();
    return html.includes(SAMPLE_MARK) ? res : new Response(null, { status: 404 });
  }
  if (url.origin === appOrigin) throw new SiteError("このアプリ自身のページは読みません");
  assertPublicUrl(url);
  if (!ipv4Parts(url.hostname) && !url.hostname.startsWith("[")) {
    const addresses = await resolve(url.hostname);
    if (addresses.length === 0 || addresses.some(isBlockedAddress)) throw new SiteError("社内や手元のアドレスには接続しません");
  }
  return fetcher(url.href, { redirect: "manual", signal, headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain" } });
};

// ---- 1ページを読む ----

const readBytes = async (res: Response, limit: number) => {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(size, limit));
  let at = 0;
  for (const c of chunks) {
    out.set(c.subarray(0, out.length - at), at);
    at += c.length;
    if (at >= out.length) break;
  }
  return out;
};

const decode = (bytes: Uint8Array, contentType: string) => {
  const head = String.fromCharCode(...bytes.subarray(0, 2048));
  const charset = (contentType.match(/charset=["']?([\w-]+)/i) ?? head.match(/<meta[^>]+charset=["']?([\w-]+)/i))?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
};

const REDIRECTS = [301, 302, 303, 307, 308];

// 転送は自分で追う。1段ごとに opener を通るので、転送先も同じ検査を受ける
export async function readPage(start: URL, open: Opener, accept: RegExp = /text\/html|application\/xhtml/i): Promise<{ url: URL; body: string }> {
  let url = start;
  for (let hop = 0; hop <= SITE_LIMITS.redirects; hop++) {
    const res = await open(url, AbortSignal.timeout(SITE_LIMITS.timeoutMs));
    if (REDIRECTS.includes(res.status)) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location) throw new SiteError("転送先が書かれていません");
      url = new URL(location, url);
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new SiteError(`ページを開けませんでした（HTTP ${res.status}）`);
    }
    const type = res.headers.get("content-type") ?? "";
    if (!accept.test(type)) {
      await res.body?.cancel();
      throw new SiteError("本文を読める種類のページではありません");
    }
    return { url, body: decode(await readBytes(res, SITE_LIMITS.bytes), type) };
  }
  throw new SiteError("転送が多すぎます");
}

// ---- 本文を取り出す（依存を足さず、1回の走査で） ----

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? all;
    const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });

const SKIP = new Set(["script", "style", "noscript", "template", "svg", "iframe"]);
const CHROME = new Set(["nav", "footer"]); // 本文に入れない。リンクは拾う
const BLOCK = /^(p|div|li|ul|ol|h[1-6]|tr|table|br|hr|section|article|aside|main|header|dd|dt|dl|blockquote|time)$/;
const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? "") : null;
};

const isoDate = (y: string, m: string, d: string) => `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
const DATE_IN_TEXT = /(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})/g;
const datesIn = (s: string) => [...s.matchAll(DATE_IN_TEXT)].map((m) => isoDate(m[1], m[2], m[3]));

// 日付はコードが読む。いくつも日付があるページ（一覧など）は決めつけず空にする
const pickDate = (declared: string[], text: string) => {
  const stated = new Set(declared.flatMap(datesIn));
  if (stated.size > 0) return stated.size === 1 ? [...stated][0] : "";
  const found = new Set(datesIn(text));
  return found.size === 1 ? [...found][0] : "";
};

export function parseHtml(html: string): Parsed {
  const lower = html.toLowerCase();
  const links: Parsed["links"] = [];
  const declared: string[] = [];
  let title = "";
  let text = "";
  let inTitle = false;
  let chromeDepth = 0;
  let anchor: { href: string; text: string } | null = null;
  let i = 0;

  const addText = (raw: string) => {
    const t = decodeEntities(raw).replace(/\s+/g, " ");
    if (inTitle) title += t;
    if (anchor) anchor.text += t;
    if (!inTitle && chromeDepth === 0) text += t;
  };

  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) { addText(html.slice(i)); break; }
    addText(html.slice(i, lt));
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    const gt = html.indexOf(">", lt);
    if (gt < 0) break;
    const tag = html.slice(lt, gt + 1);
    const name = (tag.match(/^<\/?([a-zA-Z][\w-]*)/)?.[1] ?? "").toLowerCase();
    const closing = tag[1] === "/";
    i = gt + 1;
    if (!name) continue;

    if (name === "meta" && /article:published_time|datepublished/i.test(tag)) declared.push(attr(tag, "content") ?? "");
    if (name === "title") { inTitle = !closing; continue; }
    if (SKIP.has(name) && !closing) {
      const end = lower.indexOf(`</${name}`, i);
      i = end < 0 ? html.length : Math.max(lower.indexOf(">", end) + 1, end + 1);
      continue;
    }
    if (CHROME.has(name)) { chromeDepth = Math.max(0, chromeDepth + (closing ? -1 : 1)); continue; }
    if (name === "time" && !closing) declared.push(attr(tag, "datetime") ?? "");
    if (name === "a") {
      if (closing && anchor) { links.push(anchor); anchor = null; }
      else if (!closing) {
        const href = attr(tag, "href");
        anchor = href ? { href, text: "" } : null;
      }
    }
    if (BLOCK.test(name) && chromeDepth === 0) text += "\n";
  }

  const body = text.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
  return { title: title.trim(), text: body.slice(0, SITE_LIMITS.chars), date: pickDate(declared, body), links };
}

// ---- robots.txt（実在のサイトだけ。* の組の Disallow を前方一致で見る） ----

export function robotsAllows(robots: string, path: string): boolean {
  let forAll = false;
  let inRules = false;
  const rules: string[] = [];
  for (const line of robots.split(/\r?\n/)) {
    const [key, ...rest] = line.replace(/#.*$/, "").split(":");
    const value = rest.join(":").trim();
    const k = key.trim().toLowerCase();
    if (k === "user-agent") {
      forAll = inRules ? value === "*" : forAll || value === "*";
      inRules = false;
    } else if (k === "disallow" || k === "allow") {
      inRules = true;
      if (forAll && k === "disallow" && value) rules.push(value);
    }
  }
  return !rules.some((r) => path.startsWith(r.replace(/\*.*$/, "")));
}

const loadRobots = async (site: URL, open: Opener) => {
  try {
    return (await readPage(new URL("/robots.txt", site), open, /text\/plain/i)).body;
  } catch (e) {
    if (!(e instanceof SiteError)) throw new SiteError("robots.txt を確かめられませんでした");
    if (/HTTP 4\d\d|種類/.test(e.message)) return ""; // 無いサイトは制限なし
    throw e;
  }
};

// ---- トップからたどる ----

const SECTION = /ニュース|お知らせ|リリース|プレス|決算|投資家|株主|業績|取り組み|取組|サステナ|中期|経営方針|\bir\b|news|press|release|investor|financ|sustainab|initiative/i;
const sectionDir = (u: URL) => `${u.pathname.replace(/\/?(index\.html?)?$/, "")}/`;
const clean = (u: URL) => { u.hash = ""; return u; };

const nextLinks = (page: { url: URL; links: Parsed["links"] }, depth: number, seen: Set<string>) => {
  const dir = sectionDir(page.url);
  const urls = page.links.flatMap(({ href, text }) => {
    try {
      const u = clean(new URL(href, page.url));
      if (u.origin !== page.url.origin || seen.has(u.href)) return [];
      const named = SECTION.test(`${text} ${u.pathname}`);
      return (depth === 0 ? named : u.pathname.startsWith(dir) && u.pathname !== page.url.pathname) ? [u] : [];
    } catch {
      return [];
    }
  });
  return [...new Map(urls.map((u) => [u.href, u])).values()].slice(0, depth === 0 ? SITE_LIMITS.sections : SITE_LIMITS.perSection);
};

export async function crawl(start: URL, open: Opener, useRobots: boolean): Promise<Page[]> {
  const deadline = Date.now() + SITE_LIMITS.totalMs;
  const robots = useRobots ? await loadRobots(start, open) : "";
  if (!robotsAllows(robots, start.pathname)) throw new SiteError("このサイトの robots.txt が読み取りを認めていません");
  const pages: Page[] = [];
  const seen = new Set<string>([clean(new URL(start)).href]);
  const queue = [{ url: start, depth: 0 }];
  let origin = start.origin;

  while (queue.length > 0 && pages.length < SITE_LIMITS.pages && Date.now() < deadline) {
    const item = queue.shift()!;
    if (!robotsAllows(robots, item.url.pathname)) continue;
    try {
      const { url, body } = await readPage(item.url, open);
      if (item.depth === 0) origin = url.origin; // 例：www なしから www ありへの転送
      if (url.origin !== origin || !robotsAllows(robots, url.pathname)) continue; // 転送先も同じ基準で見る
      seen.add(clean(new URL(url)).href);
      const { links, ...page } = parseHtml(body);
      pages.push({ ...page, url: url.href });
      if (item.depth < 2) {
        for (const u of nextLinks({ url, links }, item.depth, seen)) {
          seen.add(u.href);
          queue.push({ url: u, depth: item.depth + 1 });
        }
      }
    } catch (e) {
      if (item.depth > 0) continue; // 途中の1ページが読めなくても続ける
      throw e instanceof SiteError ? e : new SiteError("トップページを読めませんでした");
    }
  }
  return pages;
}
