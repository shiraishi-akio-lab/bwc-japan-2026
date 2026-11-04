import { Hono } from "hono";
import { loadBuyer } from "./accounts";
import { buyerOpening, type Turn } from "./claude";
import { loadShelf, shelfCandidates, type ShelfItem } from "./shelf";

type Bindings = { DB: D1Database; ANTHROPIC_API_KEY?: string };

export const PREP_SCENARIO = "march-shelf-prep";
const MAX_TEXT = 600;
const MAX_RETURNS = 3;

export type Stage = "opening" | "asked" | "retry" | "refused" | "agreed" | "ended";
type PrepRow = {
  id: string; session_id: string; buyer_id: string; meeting_on: string; gain_answer: string; cause_hypothesis: string;
  returns_json: string; landing: string; stage: Stage; round_turns: number; consult_json: string;
};

export const loadTurns = async (db: D1Database, sessionId: string): Promise<Turn[]> => {
  const { results } = await db
    .prepare("SELECT role, content FROM practice_messages WHERE session_id = ? ORDER BY id")
    .bind(sessionId)
    .all<Turn>();
  return results;
};

const loadPrep = (db: D1Database, id: string) => db.prepare("SELECT * FROM preps WHERE id = ?").bind(id).first<PrepRow>();
const returnsOf = (p: PrepRow) => JSON.parse(p.returns_json) as string[];

// 画面に返す形。persona は読まない
const prepView = async (db: D1Database, p: PrepRow) => {
  const found = await loadBuyer(db, p.buyer_id);
  return {
    id: p.id,
    sessionId: p.session_id,
    buyerId: p.buyer_id,
    buyerName: found?.buyer.name ?? "",
    accountName: found?.account.name ?? "",
    meetingOn: p.meeting_on,
    gainAnswer: p.gain_answer,
    causeHypothesis: p.cause_hypothesis,
    returns: returnsOf(p),
    landing: p.landing,
    stage: p.stage,
    consult: p.consult_json ? JSON.parse(p.consult_json) : null,
    turns: await loadTurns(db, p.session_id),
  };
};

export const prepRoutes = new Hono<{ Bindings: Bindings }>();

// 入口で選べる相手。棚データのある取引先だけ
prepRoutes.get("/preps/buyers", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT b.id, b.name, b.role, a.name AS account_name FROM buyers b JOIN accounts a ON a.id = b.account_id
     WHERE b.status = '現役' AND EXISTS (SELECT 1 FROM shelf_items s WHERE s.account_id = a.id) ORDER BY a.name`,
  ).all();
  return c.json(results);
});

// 続きから開くための一覧
prepRoutes.get("/preps", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.meeting_on, p.stage, p.updated_at, b.name AS buyer_name, a.name AS account_name
     FROM preps p JOIN buyers b ON b.id = p.buyer_id JOIN accounts a ON a.id = b.account_id
     ORDER BY p.updated_at DESC LIMIT 5`,
  ).all();
  return c.json(results);
});

prepRoutes.post("/preps", async (c) => {
  const { buyerId, meetingOn } = await c.req.json<{ buyerId?: string; meetingOn?: string }>();
  const found = buyerId ? await loadBuyer(c.env.DB, buyerId) : null;
  if (!found || found.buyer.status !== "現役") return c.json({ error: "担当バイヤーを選んでください" }, 400);
  if (!meetingOn || !/^\d{4}-\d{2}-\d{2}$/.test(meetingOn)) return c.json({ error: "次の商談日を入れてください" }, 400);
  const id = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO practice_sessions (id, scenario_id, buyer_id, use_record) VALUES (?, ?, ?, 1)").bind(sessionId, PREP_SCENARIO, found.buyer.id),
    c.env.DB.prepare("INSERT INTO practice_messages (session_id, role, content) VALUES (?, 'buyer', ?)").bind(sessionId, buyerOpening(found.buyer.name)),
    c.env.DB.prepare("INSERT INTO preps (id, session_id, buyer_id, meeting_on) VALUES (?, ?, ?, ?)").bind(id, sessionId, found.buyer.id, meetingOn),
  ]);
  return c.json(await prepView(c.env.DB, (await loadPrep(c.env.DB, id))!));
});

prepRoutes.get("/preps/:id", async (c) => {
  const p = await loadPrep(c.env.DB, c.req.param("id"));
  if (!p) return c.json({ error: "準備が見つかりません" }, 404);
  return c.json(await prepView(c.env.DB, p));
});

type PrepBody = { gainAnswer?: string; causeHypothesis?: string; returns?: string[]; landing?: string };
const text = (s: string) => s.trim().slice(0, MAX_TEXT);

// 書いた内容を残す。段階は画面から変えられない
prepRoutes.patch("/preps/:id", async (c) => {
  const p = await loadPrep(c.env.DB, c.req.param("id"));
  if (!p) return c.json({ error: "準備が見つかりません" }, 404);
  const b = await c.req.json<PrepBody>();
  const returns = b.returns ? b.returns.map(text).filter(Boolean).slice(0, MAX_RETURNS) : returnsOf(p);
  await c.env.DB.prepare(
    "UPDATE preps SET gain_answer = ?, cause_hypothesis = ?, returns_json = ?, landing = ?, updated_at = datetime('now') WHERE id = ?",
  ).bind(
    b.gainAnswer === undefined ? p.gain_answer : text(b.gainAnswer),
    b.causeHypothesis === undefined ? p.cause_hypothesis : text(b.causeHypothesis),
    JSON.stringify(returns),
    b.landing === undefined ? p.landing : text(b.landing),
    p.id,
  ).run();
  return c.json(await prepView(c.env.DB, (await loadPrep(c.env.DB, p.id))!));
});

// ベテランの判断。問いが先：得の答えが空なら、候補もカードも返さない
prepRoutes.get("/preps/:id/judgment", async (c) => {
  const p = await loadPrep(c.env.DB, c.req.param("id"));
  if (!p) return c.json({ error: "準備が見つかりません" }, 404);
  if (!p.gain_answer.trim()) return c.json({ error: "先に、相手の得は何かを書いてください" }, 409);
  if (p.stage === "opening") return c.json({ error: "先に、バイヤーの問いを受けてください" }, 409);
  const found = await loadBuyer(c.env.DB, p.buyer_id);
  const shelf = await loadShelf(c.env.DB, found!.account.id);
  return c.json({ candidates: shelfCandidates(shelf) satisfies ShelfItem[] });
});
