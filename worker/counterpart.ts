import { Hono } from "hono";
import { loadAccount, loadBuyer, type Account, type Buyer } from "./accounts";
import { hit } from "./auth";
import { readInterests } from "./claude";
import { loadPos, type Pos } from "./pos";
import { assertPublicUrl, crawl, isSamplePage, makeOpener, resolveInput, SiteError } from "./site";
import type { AppEnv, InterestTheme } from "./types";

// 相手の棚：企業の関心（公開情報を読み、読んだ本人が確かめる）・担当者の傾向（読むだけ）・ことカレンダー（読むだけ）
export type Interest = {
  id: string; account_id: string; text: string; basis: string; theme: InterestTheme; source_url: string; source_title: string;
  published_on: string; fetched_on: string; status: "pending" | "approved" | "rejected";
};
export type Observation = { id: string; tendency: string; keywords: string[]; basis: string; held_on: string };
export type SeasonEvent = {
  id: string; name: string; month: number; day: number; deadline_month: number; deadline_day: number;
  store_action: string; proposal: string; own_result: string;
};
export type DatedEvent = SeasonEvent & { event_on: string; deadline_on: string };

const MAX_INTERESTS = 3;
const MAX_OBSERVATIONS = 2;
const MAX_EVENTS = 2;
const MAX_AGE_DAYS = 365;
const MIN_PAGE_TEXT = 30; // これより短いページは読まない（見出しだけのページ）
const DAY = 86_400_000;
export const READS_PER_HOUR = 20; // 公開情報の読み取りは1人1時間にこの回数まで

const datedOn = (i: Interest) => i.published_on || i.fetched_on;

// 準備室に出す関心：承認済みで、棚の提案に結びつく種類で、商談日から見て古すぎないものを新しい順に
export const selectInterests = (rows: Interest[], meetingOn: string): Interest[] =>
  rows
    .filter((i) => i.status === "approved" && i.theme !== "その他")
    .filter((i) => {
      const age = (Date.parse(meetingOn) - Date.parse(datedOn(i))) / DAY;
      return age >= 0 && age <= MAX_AGE_DAYS;
    })
    // 掲載日の読めないものは、取得日で新着に見せず、日付のあるものの後ろに置く
    .sort((a, b) => b.published_on.localeCompare(a.published_on) || a.id.localeCompare(b.id))
    .slice(0, MAX_INTERESTS);

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// 次の行事はコードで選ぶ（Claude に選ばせない）。行事の日でなく、提案の締切がまだ先のものを近い順に。
// 締切を過ぎた行事は今から提案しても間に合わないので出さない
export const selectEvents = (events: SeasonEvent[], meetingOn: string): DatedEvent[] => {
  const year = Number(meetingOn.slice(0, 4));
  return [year, year + 1, year + 2]
    .flatMap((y) => events.map((e) => ({
      ...e,
      event_on: iso(y, e.month, e.day),
      deadline_on: iso(e.deadline_month > e.month ? y - 1 : y, e.deadline_month, e.deadline_day),
    })))
    .filter((e) => e.deadline_on >= meetingOn)
    .sort((a, b) => a.deadline_on.localeCompare(b.deadline_on) || a.id.localeCompare(b.id))
    .slice(0, MAX_EVENTS);
};

// 傾向は全部を渡さない。今の準備に出てくる言葉と重なるものを先に、同じなら新しい順に
export const selectObservations = (rows: Observation[], context: string): Observation[] =>
  rows
    .map((o) => ({ o, hits: o.keywords.filter((k) => context.includes(k)).length }))
    .sort((a, b) => b.hits - a.hits || b.o.held_on.localeCompare(a.o.held_on) || a.o.id.localeCompare(b.o.id))
    .slice(0, MAX_OBSERVATIONS)
    .map(({ o }) => o);

export const loadInterests = async (db: D1Database, accountId: string) => {
  const { results } = await db.prepare(
    "SELECT id, account_id, text, basis, theme, source_url, source_title, published_on, fetched_on, status FROM company_interests WHERE account_id = ? AND status != 'rejected' ORDER BY published_on DESC, id",
  )
    .bind(accountId).all<Interest>();
  return results;
};

// 確定した商談の分だけを読む（priorities・施策の結果と同じ）
export const confirmedObservations = async (db: D1Database, buyerId: string): Promise<Observation[]> => {
  const { results } = await db.prepare(
    `SELECT o.id, o.tendency, o.keywords_json, o.basis, m.held_on FROM buyer_observations o
     JOIN meetings m ON m.id = o.meeting_id
     WHERE o.buyer_id = ? AND m.status = 'confirmed' ORDER BY m.held_on DESC`,
  ).bind(buyerId).all<Omit<Observation, "keywords"> & { keywords_json: string }>();
  return results.map(({ keywords_json, ...o }) => ({ ...o, keywords: JSON.parse(keywords_json) as string[] }));
};

export const loadEvents = async (db: D1Database) =>
  (await db.prepare("SELECT id, name, month, day, deadline_month, deadline_day, store_action, proposal, own_result FROM season_events ORDER BY month, day").all<SeasonEvent>()).results;

export type Brief = { interests: Interest[]; observations: Observation[]; events: DatedEvent[] };

// 準備室の「相手と時期の下調べ」。画面にも Claude にもここを通したものだけが渡る
export async function prepBrief(db: D1Database, buyer: Buyer, account: Account, meetingOn: string, written = ""): Promise<Brief> {
  const [interests, observations, events] = await Promise.all([loadInterests(db, account.id), confirmedObservations(db, buyer.id), loadEvents(db)]);
  const picked = { interests: selectInterests(interests, meetingOn), events: selectEvents(events, meetingOn) };
  const context = [written, ...picked.interests.map((i) => i.text), ...picked.events.map((e) => `${e.name}${e.proposal}`)].join("\n");
  return { ...picked, observations: selectObservations(observations, context) };
}

// 確定した商談の、終わっていない約束
export const confirmedPromises = async (db: D1Database, buyerId: string) =>
  (await db.prepare(
    "SELECT r.text, r.due FROM promises r JOIN meetings m ON m.id = r.meeting_id WHERE m.buyer_id = ? AND m.status = 'confirmed' AND r.done = 0 ORDER BY m.held_on DESC",
  ).bind(buyerId).all<{ text: string; due: string }>()).results;

type MeetingRow = { held_on: string; kind: string; summary: string; decisions_json: string };
export type Partner = Brief & {
  pos: Pos | null; promises: { text: string; due: string }[];
  meetings: { held_on: string; kind: string; summary: string; decisions: string[] }[];
};

// 準備室の「相手の情報」。読むものはここで決める。棚の品ごとの表、バイヤーだけの列、候補、下書きは読まない。
// 残った論点は読まない（問いより先に、外す品の答えが見えてしまう）
export async function prepPartner(db: D1Database, buyer: Buyer, account: Account, meetingOn: string): Promise<Partner> {
  const [interests, observations, events, pos, promises, meetings] = await Promise.all([
    loadInterests(db, account.id), confirmedObservations(db, buyer.id), loadEvents(db), loadPos(db, account.id, meetingOn), confirmedPromises(db, buyer.id),
    db.prepare("SELECT held_on, kind, summary, decisions_json FROM meetings WHERE buyer_id = ? AND status = 'confirmed' ORDER BY held_on DESC").bind(buyer.id).all<MeetingRow>(),
  ]);
  return {
    interests: selectInterests(interests, meetingOn),
    observations,
    events: selectEvents(events, meetingOn),
    pos,
    promises,
    meetings: meetings.results.map(({ decisions_json, ...m }) => ({ ...m, decisions: JSON.parse(decisions_json) as string[] })),
  };
}

// ページの題は検査していない外部の文なので、Claude への入力に入れない（画面にだけ出す）
const interestLines = (b: Brief) => b.interests.map((i) => `- ${i.text}（${i.published_on || "掲載日不明"}）`);

// バイヤー役に渡す分。自分の会社の公開情報と時期だけ。観察のメモと、メーカー側の実績は渡さない
export const buyerBriefText = (b: Brief) =>
  [
    ...(b.interests.length ? ["自社が公開している方針：", ...interestLines(b)] : []),
    ...(b.events.length ? ["これからの行事：", ...b.events.map((e) => `- ${e.name}（${e.event_on}ごろ）：${e.store_action}`)] : []),
  ].join("\n");

// 確かめる係・次を決める係に渡す分
export const coachBriefText = (b: Brief) =>
  [
    ...(b.interests.length ? ["公開情報から人が確かめた相手の関心：", ...interestLines(b)] : []),
    ...(b.observations.length ? ["商談で観察された傾向：", ...b.observations.map((o) => `- ${o.tendency}（${o.held_on}・${o.basis}）`)] : []),
    ...(b.events.length
      ? ["時期（提案の締切が先のもの）：", ...b.events.map((e) => `- ${e.name}（締切の目安 ${e.deadline_on}）：店の動き ${e.store_action}／提案 ${e.proposal}／自社の過去の実績 ${e.own_result}`)]
      : []),
  ].join("\n");

export const counterpartRoutes = new Hono<AppEnv>();

// 公開情報なので、候補も会社の全員が見る。準備室と Claude に渡すのは、人が確かめたものだけ
counterpartRoutes.get("/accounts/:id/interests", async (c) => {
  const me = c.get("user");
  const account = await loadAccount(c.env.DB, c.req.param("id"), me.company_id);
  if (!account) return c.json({ error: "取引先が見つかりません" }, 404);
  return c.json(await loadInterests(c.env.DB, account.id));
});

// 公開情報を読む。読むのは1回に1社分。すでに候補を作ったページは Claude に渡し直さない
counterpartRoutes.post("/accounts/:id/read-site", async (c) => {
  const db = c.env.DB;
  const me = c.get("user");
  const account = await loadAccount(db, c.req.param("id"), me.company_id);
  if (!account) return c.json({ error: "取引先が見つかりません" }, 404);
  if (!(await hit(db, `read-site:${me.id}`, READS_PER_HOUR, 3600))) return c.json({ error: "読み取りの回数の上限です。しばらくしてからやり直してください" }, 429);
  const { url: raw } = await c.req.json<{ url?: string }>();
  const input = (raw ?? account.site_url).trim();
  if (!input) return c.json({ error: "読む URL を入れてください" }, 400);

  const appOrigin = new URL(c.req.url).origin;
  try {
    const start = resolveInput(input, appOrigin);
    const sample = isSamplePage(start, appOrigin);
    if (!sample) assertPublicUrl(start);
    const pages = await crawl(start, makeOpener({ appOrigin, assets: c.env.ASSETS }), !sample);
    const stored = (href: string) => (href.startsWith(`${appOrigin}/`) ? href.slice(appOrigin.length) : href);
    const { results: known } = await db.prepare("SELECT DISTINCT source_url FROM company_interests WHERE account_id = ?").bind(account.id).all<{ source_url: string }>();
    const done = new Set(known.map((k) => k.source_url));
    const fresh = pages.filter((p) => p.text.length >= MIN_PAGE_TEXT && !done.has(stored(p.url)));
    const read = pages.map(({ url, title, date }) => ({ url: stored(url), title, date }));
    if (fresh.length === 0) return c.json({ pages: read, added: 0 });

    const key = c.env.ANTHROPIC_API_KEY;
    if (!key) return c.json({ error: "API キーが設定されていません" }, 503);
    const drafts = await readInterests(key, account.name, fresh.map((p, id) => ({ id, title: p.title, text: p.text })));
    const fetchedOn = new Date().toISOString().slice(0, 10);
    if (drafts.length > 0) {
      await db.batch(drafts.map((d) => {
        const page = fresh[d.pageId];
        return db.prepare(
          "INSERT INTO company_interests (id, account_id, text, basis, theme, source_url, source_title, published_on, fetched_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(crypto.randomUUID(), account.id, d.text, d.quote, d.theme, stored(page.url), page.title.slice(0, 200), page.date, fetchedOn);
      }));
    }
    return c.json({ pages: read, added: drafts.length });
  } catch (e) {
    if (e instanceof SiteError) return c.json({ error: e.message }, 400);
    throw e;
  }
});

// 関心の候補を、読んだ人が出どころを見て確かめる（使う・使わない）
counterpartRoutes.post("/interests/:id", async (c) => {
  const { status } = await c.req.json<{ status?: string }>();
  if (status !== "approved" && status !== "rejected") return c.json({ error: "使うか使わないかを選んでください" }, 400);
  const r = await c.env.DB.prepare("UPDATE company_interests SET status = ? WHERE id = ? AND account_id IN (SELECT id FROM accounts WHERE company_id = ?)")
    .bind(status, c.req.param("id"), c.get("user").company_id).run();
  if (r.meta.changes === 0) return c.json({ error: "候補が見つかりません" }, 404);
  return c.json({ ok: true });
});

counterpartRoutes.get("/buyers/:id/observations", async (c) => {
  const found = await loadBuyer(c.env.DB, c.req.param("id"), c.get("user").company_id);
  if (!found) return c.json({ error: "担当バイヤーが見つかりません" }, 404);
  return c.json(await confirmedObservations(c.env.DB, found.buyer.id));
});

counterpartRoutes.get("/season-events", async (c) => c.json(await loadEvents(c.env.DB)));
