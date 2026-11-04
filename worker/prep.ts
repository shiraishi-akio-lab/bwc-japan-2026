import { Hono } from "hono";
import { buildRecord, buyerPersona, confirmedResults, loadBuyer } from "./accounts";
import { approvedCard, cardBody, DEMO_CARD_ID } from "./card";
import { buyerOpening, buyerStaged, KEY_QUESTION, RETRY_LINE, ROUND_END_LINE, writeConsult, type BuyerMove, type Turn } from "./claude";
import { cases } from "./data";
import { agreementCondition, buyerShelfNotes, loadShelf, shelfCandidates, type ShelfItem } from "./shelf";

type Bindings = { DB: D1Database; ANTHROPIC_API_KEY?: string };

export const PREP_SCENARIO = "march-shelf-prep";
const MAX_TEXT = 600;
const MAX_RETURNS = 3;
const MIN_RETURNS = 2;
const ROUND_LIMIT = 5; // 1回に若手が話せる回数。超える前に固定文で閉じる＝答え直せば何度でも続く

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
  const gain = b.gainAnswer === undefined ? p.gain_answer : text(b.gainAnswer);
  const returns = JSON.stringify(b.returns ? b.returns.map(text).filter(Boolean).slice(0, MAX_RETURNS) : returnsOf(p));
  const landing = b.landing === undefined ? p.landing : text(b.landing);
  // 相談文の元が変わったら、古い1枚を残さない
  const stale = gain !== p.gain_answer || returns !== p.returns_json || landing !== p.landing;
  await c.env.DB.prepare(
    "UPDATE preps SET gain_answer = ?, cause_hypothesis = ?, returns_json = ?, landing = ?, consult_json = ?, updated_at = datetime('now') WHERE id = ?",
  ).bind(
    gain,
    b.causeHypothesis === undefined ? p.cause_hypothesis : text(b.causeHypothesis),
    returns,
    landing,
    stale ? "" : p.consult_json,
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
  const card = approvedCard(cases, DEMO_CARD_ID);
  return c.json({ candidates: shelfCandidates(shelf) satisfies ShelfItem[], card: card && cardBody(card) });
});

const preparedEnough = (p: PrepRow) => returnsOf(p).length >= MIN_RETURNS && p.landing.trim() !== "";

// 止まる練習。何を返すかは段階で決まる。1本目は断り、2本目は条件を満たせば合意する
prepRoutes.post("/preps/:id/turn", async (c) => {
  const db = c.env.DB;
  const p = await loadPrep(db, c.req.param("id"));
  if (!p) return c.json({ error: "準備が見つかりません" }, 404);
  const { text: raw } = await c.req.json<{ text?: string }>();
  const said = (raw ?? "").trim();
  if (!said || said.length > MAX_TEXT) return c.json({ error: `発言は1〜${MAX_TEXT}字で入力してください` }, 400);
  if (!p.gain_answer.trim()) return c.json({ error: "先に、相手の得は何かを書いてください" }, 409);
  if (p.stage === "agreed" || p.stage === "ended") return c.json({ error: "この回は終わりです。答え直すか、相談文に進んでください" }, 409);

  const found = (await loadBuyer(db, p.buyer_id))!;
  const shelf = await loadShelf(db, found.account.id);
  const rounds = p.round_turns + 1;
  const atLimit = rounds >= ROUND_LIMIT;
  const history = await loadTurns(db, p.session_id);
  const repLines = history.filter((t) => t.role === "rep").map((t) => t.content);
  const saidThisRound = p.round_turns > 0 ? repLines.slice(-p.round_turns) : [];
  const removable = shelf.filter((i) => !i.is_pb).map((i) => i.short_name);
  const agreed = p.stage === "refused" && agreementCondition(said, removable, returnsOf(p), p.landing, saidThisRound);

  let stage: Stage;
  let move: BuyerMove | "question" | "closed";
  if (p.stage === "opening") [stage, move] = ["asked", "question"];
  else if (p.stage === "retry") [stage, move] = ["refused", "refuse"];
  else if (agreed) [stage, move] = ["agreed", "agree"];
  else if (atLimit) [stage, move] = ["ended", "closed"];
  else if (p.stage === "asked") [stage, move] = ["asked", "push"];
  else [stage, move] = ["refused", "hold"];

  let reply: string;
  if (move === "question") reply = KEY_QUESTION;
  else if (move === "closed") reply = ROUND_END_LINE;
  else {
    const key = c.env.ANTHROPIC_API_KEY;
    if (!key) return c.json({ error: "API キーが設定されていません" }, 503);
    const record = await buildRecord(db, found.buyer, found.account);
    const turns: Turn[] = [...history, { role: "rep", content: said }];
    const repSaid = [...repLines, said].join("\n");
    const notes = await buyerShelfNotes(db, found.account.id);
    const unsaid = move === "push" ? shelf.map((i) => i.short_name).filter((n) => !repSaid.includes(n)) : [];
    reply = await buyerStaged(key, turns, buyerPersona(found.buyer, found.account, record), notes.text, move, [...notes.secrets, ...unsaid]);
  }

  await db.batch([
    db.prepare("INSERT INTO practice_messages (session_id, role, content) VALUES (?, 'rep', ?)").bind(p.session_id, said),
    db.prepare("INSERT INTO practice_messages (session_id, role, content) VALUES (?, 'buyer', ?)").bind(p.session_id, reply),
    db.prepare("UPDATE preps SET stage = ?, round_turns = ?, updated_at = datetime('now') WHERE id = ?").bind(stage, rounds, p.id),
  ]);
  return c.json({ move, prep: await prepView(db, (await loadPrep(db, p.id))!) });
});

// 答え直す：同じセッションの続きに、もう一度問いを置く。新しい商談は作らない
prepRoutes.post("/preps/:id/retry", async (c) => {
  const db = c.env.DB;
  const p = await loadPrep(db, c.req.param("id"));
  if (!p) return c.json({ error: "準備が見つかりません" }, 404);
  if (p.stage === "opening") return c.json({ error: "先に、バイヤーの問いを受けてください" }, 409);
  if (!preparedEnough(p)) return c.json({ error: `返しを${MIN_RETURNS}本以上と、落としどころを書いてください` }, 400);
  if (p.stage !== "retry") {
    await db.batch([
      db.prepare("INSERT INTO practice_messages (session_id, role, content) VALUES (?, 'buyer', ?)").bind(p.session_id, RETRY_LINE),
      db.prepare("UPDATE preps SET stage = 'retry', round_turns = 0, updated_at = datetime('now') WHERE id = ?").bind(p.id),
    ]);
  }
  return c.json(await prepView(db, (await loadPrep(db, p.id))!));
});

// 上司への相談文。返しと落としどころはそのまま写し、Claude は要約と確かめたいことだけを書く
prepRoutes.post("/preps/:id/consult", async (c) => {
  const db = c.env.DB;
  const p = await loadPrep(db, c.req.param("id"));
  if (!p) return c.json({ error: "準備が見つかりません" }, 404);
  if (!preparedEnough(p)) return c.json({ error: `返しを${MIN_RETURNS}本以上と、落としどころを書いてください` }, 400);
  const key = c.env.ANTHROPIC_API_KEY;
  if (!key) return c.json({ error: "API キーが設定されていません" }, 503);
  const found = (await loadBuyer(db, p.buyer_id))!;
  const candidates = shelfCandidates(await loadShelf(db, found.account.id)).map(({ name, maker, is_own, facings, weekly_units, yoy_pct }) => ({
    name, maker, is_own, facings, weekly_units, yoy_pct,
  }));
  const returns = returnsOf(p);
  const draft = await writeConsult(key, { gainAnswer: p.gain_answer, returns, landing: p.landing, candidates });
  const consult = { gainAnswer: p.gain_answer, returns, landing: p.landing, ...draft };
  await db.prepare("UPDATE preps SET consult_json = ?, updated_at = datetime('now') WHERE id = ?").bind(JSON.stringify(consult), p.id).run();
  return c.json(await prepView(db, (await loadPrep(db, p.id))!));
});

// 前回の続き：確定した商談の約束と施策の結果だけを出す。結果が悪ければ原因の仮説を問う
prepRoutes.get("/preps/:id/recap", async (c) => {
  const db = c.env.DB;
  const p = await loadPrep(db, c.req.param("id"));
  if (!p) return c.json({ error: "準備が見つかりません" }, 404);
  const [meeting, promises, results] = await Promise.all([
    db.prepare("SELECT held_on, kind, summary FROM meetings WHERE buyer_id = ? AND status = 'confirmed' ORDER BY held_on DESC LIMIT 1")
      .bind(p.buyer_id).first<{ held_on: string; kind: string; summary: string }>(),
    db.prepare(
      "SELECT r.text, r.due FROM promises r JOIN meetings m ON m.id = r.meeting_id WHERE m.buyer_id = ? AND m.status = 'confirmed' AND r.done = 0 ORDER BY m.held_on DESC",
    ).bind(p.buyer_id).all<{ text: string; due: string }>(),
    confirmedResults(db, p.buyer_id),
  ]);
  return c.json({ meeting, promises: promises.results, results, askCause: results.some((r) => r.outcome === "bad") });
});
