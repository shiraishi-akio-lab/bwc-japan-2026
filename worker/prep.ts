import { Hono } from "hono";
import { buildRecord, buyerPersona, confirmedResults, loadBuyer } from "./accounts";
import { approvedCard, cardBody, DEMO_CARD_ID } from "./card";
import { buyerOpening, buyerStaged, KEY_QUESTION, RETRY_LINE, ROUND_END_LINE, writeConsult, type BuyerMove, type Turn } from "./claude";
import { buyerBriefText, confirmedPromises, prepBrief, prepPartner } from "./counterpart";
import { cases } from "./data";
import { companyCards } from "./manager";
import { loadPos } from "./pos";
import { agreementCondition, buyerShelfNotes, loadShelf, shelfCandidates, type ShelfItem } from "./shelf";
import type { AppEnv, SessionUser } from "./types";

export const PREP_SCENARIO = "march-shelf-prep";
const MAX_TEXT = 600;
const MAX_RETURNS = 3;
const MIN_RETURNS = 2;
const ROUND_LIMIT = 5; // 1回に若手が話せる回数。超える前に固定文で閉じる＝答え直せば何度でも続く
const MORE_CARDS = 2; // 固定のカードに添える、会社で承認されたカードの数

export type Stage = "opening" | "asked" | "retry" | "refused" | "agreed" | "ended";
type PrepRow = {
  id: string; session_id: string; buyer_id: string; meeting_on: string; gain_answer: string; cause_hypothesis: string;
  returns_json: string; landing: string; stage: Stage; round_turns: number; consult_json: string; submitted_at: string;
  goal: string; occasion_id: string; reply_json: string;
};
const PREP_COLS = "id, session_id, buyer_id, meeting_on, gain_answer, cause_hypothesis, returns_json, landing, stage, round_turns, consult_json, submitted_at, goal, occasion_id, reply_json";

export const loadTurns = async (db: D1Database, sessionId: string): Promise<Turn[]> => {
  const { results } = await db
    .prepare("SELECT role, content FROM practice_messages WHERE session_id = ? ORDER BY id")
    .bind(sessionId)
    .all<Turn>();
  return results;
};

// 準備は作った本人だけが開ける。他人の id なら無いものとして扱う（全ルートがここを通る）
const loadPrep = (db: D1Database, id: string, me: SessionUser) =>
  db.prepare(`SELECT ${PREP_COLS} FROM preps WHERE id = ? AND user_id = ?`).bind(id, me.id).first<PrepRow>();
const returnsOf = (p: PrepRow) => JSON.parse(p.returns_json) as string[];
// 相談文が変わったら、上司の返事は「前の相談への返事」になる
const staleReply = (s: string) => (s ? JSON.stringify({ ...JSON.parse(s), stale: true }) : "");
const occasionName = async (db: D1Database, id: string) =>
  id ? (await db.prepare("SELECT name FROM season_events WHERE id = ?").bind(id).first<{ name: string }>())?.name ?? "" : "";

// 画面に返す形。persona は読まない
const prepView = async (db: D1Database, p: PrepRow, me: SessionUser) => {
  const found = await loadBuyer(db, p.buyer_id, me.company_id);
  return {
    id: p.id,
    sessionId: p.session_id,
    buyerId: p.buyer_id,
    buyerName: found?.buyer.name ?? "",
    accountName: found?.account.name ?? "",
    accountId: found?.account.id ?? "",
    accountSite: found?.account.site_url ?? "",
    meetingOn: p.meeting_on,
    goal: p.goal,
    occasionId: p.occasion_id,
    occasionName: await occasionName(db, p.occasion_id),
    gainAnswer: p.gain_answer,
    causeHypothesis: p.cause_hypothesis,
    returns: returnsOf(p),
    landing: p.landing,
    stage: p.stage,
    consult: p.consult_json ? JSON.parse(p.consult_json) : null,
    reply: p.reply_json ? JSON.parse(p.reply_json) : null,
    submittedAt: p.submitted_at,
    turns: await loadTurns(db, p.session_id),
  };
};

// 相手と時期の下調べ。今の準備に書いた言葉を渡して、当てはまるものを絞る
type Found = NonNullable<Awaited<ReturnType<typeof loadBuyer>>>;
const briefOf = (db: D1Database, p: PrepRow, found: Found) =>
  prepBrief(db, found.buyer, found.account, p.meeting_on, [p.gain_answer, ...returnsOf(p), p.landing].join("\n"));

// 確かめる係・次を決める係に渡すとき用：セッションから準備を引く
export const briefOfSession = async (db: D1Database, sessionId: string, found: Found) => {
  const p = await db.prepare(`SELECT ${PREP_COLS} FROM preps WHERE session_id = ?`).bind(sessionId).first<PrepRow>();
  return p ? briefOf(db, p, found) : null;
};

export const prepRoutes = new Hono<AppEnv>();

// 入口で選べる相手。棚データのある取引先だけ
prepRoutes.get("/preps/buyers", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT b.id, b.name, b.role, a.name AS account_name FROM buyers b JOIN accounts a ON a.id = b.account_id
     WHERE b.status = '現役' AND a.company_id = ? AND EXISTS (SELECT 1 FROM shelf_items s WHERE s.account_id = a.id) ORDER BY a.name`,
  ).bind(c.get("user").company_id).all();
  return c.json(results);
});

// 続きから開くための一覧
prepRoutes.get("/preps", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.meeting_on, p.stage, p.updated_at, b.name AS buyer_name, a.name AS account_name
     FROM preps p JOIN buyers b ON b.id = p.buyer_id JOIN accounts a ON a.id = b.account_id
     WHERE p.user_id = ? ORDER BY p.updated_at DESC LIMIT 5`,
  ).bind(c.get("user").id).all();
  return c.json(results);
});

prepRoutes.post("/preps", async (c) => {
  const { buyerId, meetingOn } = await c.req.json<{ buyerId?: string; meetingOn?: string }>();
  const me = c.get("user");
  const found = buyerId ? await loadBuyer(c.env.DB, buyerId, me.company_id) : null;
  if (!found || found.buyer.status !== "現役") return c.json({ error: "担当バイヤーを選んでください" }, 400);
  if (!meetingOn || !/^\d{4}-\d{2}-\d{2}$/.test(meetingOn)) return c.json({ error: "次の商談日を入れてください" }, 400);
  const id = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO practice_sessions (id, scenario_id, buyer_id, use_record, user_id) VALUES (?, ?, ?, 1, ?)").bind(sessionId, PREP_SCENARIO, found.buyer.id, me.id),
    c.env.DB.prepare("INSERT INTO practice_messages (session_id, role, content) VALUES (?, 'buyer', ?)").bind(sessionId, buyerOpening(found.buyer.name)),
    c.env.DB.prepare("INSERT INTO preps (id, session_id, buyer_id, meeting_on, user_id) VALUES (?, ?, ?, ?, ?)").bind(id, sessionId, found.buyer.id, meetingOn, me.id),
  ]);
  return c.json(await prepView(c.env.DB, (await loadPrep(c.env.DB, id, me))!, me));
});

prepRoutes.get("/preps/:id", async (c) => {
  const p = await loadPrep(c.env.DB, c.req.param("id"), c.get("user"));
  if (!p) return c.json({ error: "準備が見つかりません" }, 404);
  return c.json(await prepView(c.env.DB, p, c.get("user")));
});

type PrepBody = { goal?: string; occasionId?: string; gainAnswer?: string; causeHypothesis?: string; returns?: string[]; landing?: string };
const text = (s: string) => s.trim().slice(0, MAX_TEXT);

// 書いた内容を残す。段階は画面から変えられない
prepRoutes.patch("/preps/:id", async (c) => {
  const p = await loadPrep(c.env.DB, c.req.param("id"), c.get("user"));
  if (!p) return c.json({ error: "準備が見つかりません" }, 404);
  const b = await c.req.json<PrepBody>();
  const goal = b.goal === undefined ? p.goal : text(b.goal);
  const occasion = b.occasionId === undefined ? p.occasion_id : b.occasionId;
  if (occasion !== p.occasion_id && !(await occasionName(c.env.DB, occasion))) return c.json({ error: "機会を選び直してください" }, 400);
  const gain = b.gainAnswer === undefined ? p.gain_answer : text(b.gainAnswer);
  const returns = JSON.stringify(b.returns ? b.returns.map(text).filter(Boolean).slice(0, MAX_RETURNS) : returnsOf(p));
  const landing = b.landing === undefined ? p.landing : text(b.landing);
  // 相談文の元が変わったら、古い1枚を残さない
  const stale = goal !== p.goal || occasion !== p.occasion_id || gain !== p.gain_answer || returns !== p.returns_json || landing !== p.landing;
  await c.env.DB.prepare(
    "UPDATE preps SET goal = ?, occasion_id = ?, gain_answer = ?, cause_hypothesis = ?, returns_json = ?, landing = ?, consult_json = ?, submitted_at = ?, reply_json = ?, updated_at = datetime('now') WHERE id = ?",
  ).bind(
    goal,
    occasion,
    gain,
    b.causeHypothesis === undefined ? p.cause_hypothesis : text(b.causeHypothesis),
    returns,
    landing,
    stale ? "" : p.consult_json,
    stale ? "" : p.submitted_at,
    stale ? staleReply(p.reply_json) : p.reply_json,
    p.id,
  ).run();
  return c.json(await prepView(c.env.DB, (await loadPrep(c.env.DB, p.id, c.get("user")))!, c.get("user")));
});

// ベテランの判断。問いが先：得の答えが空なら、候補もカードも返さない
prepRoutes.get("/preps/:id/judgment", async (c) => {
  const p = await loadPrep(c.env.DB, c.req.param("id"), c.get("user"));
  if (!p) return c.json({ error: "準備が見つかりません" }, 404);
  if (!p.goal.trim()) return c.json({ error: "先に、今回は何のために会うかを書いてください" }, 409);
  if (!p.gain_answer.trim()) return c.json({ error: "先に、相手の得は何かを書いてください" }, 409);
  if (p.stage === "opening") return c.json({ error: "先に、バイヤーの問いを受けてください" }, 409);
  const found = await loadBuyer(c.env.DB, p.buyer_id, c.get("user").company_id);
  const shelf = await loadShelf(c.env.DB, found!.account.id);
  const card = approvedCard(cases, DEMO_CARD_ID);
  const more = (await companyCards(c.env.DB, c.get("user").company_id)).slice(0, MORE_CARDS);
  return c.json({ candidates: shelfCandidates(shelf) satisfies ShelfItem[], card: card && cardBody(card), moreCards: more.map(cardBody) });
});

const preparedEnough = (p: PrepRow) => returnsOf(p).length >= MIN_RETURNS && p.landing.trim() !== "";

// 止まる練習。何を返すかは段階で決まる。1本目は断り、2本目は条件を満たせば合意する
prepRoutes.post("/preps/:id/turn", async (c) => {
  const db = c.env.DB;
  const p = await loadPrep(db, c.req.param("id"), c.get("user"));
  if (!p) return c.json({ error: "準備が見つかりません" }, 404);
  const { text: raw } = await c.req.json<{ text?: string }>();
  const said = (raw ?? "").trim();
  if (!said || said.length > MAX_TEXT) return c.json({ error: `発言は1〜${MAX_TEXT}字で入力してください` }, 400);
  if (!p.goal.trim()) return c.json({ error: "先に、今回は何のために会うかを書いてください" }, 409);
  if (!p.gain_answer.trim()) return c.json({ error: "先に、相手の得は何かを書いてください" }, 409);
  if (p.stage === "agreed" || p.stage === "ended") return c.json({ error: "この回は終わりです。答え直すか、相談文に進んでください" }, 409);

  const found = (await loadBuyer(db, p.buyer_id, c.get("user").company_id))!;
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
    const brief = await briefOf(db, p, found);
    const topic = await occasionName(db, p.occasion_id); // 本人の目的は渡さない。相手は知らないはずのことなので
    const record = [await buildRecord(db, found.buyer, found.account), buyerBriefText(brief), topic && `今回の商談の話題：${topic}`].filter(Boolean).join("\n");
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
  return c.json({ move, prep: await prepView(db, (await loadPrep(db, p.id, c.get("user")))!, c.get("user")) });
});

// 答え直す：同じセッションの続きに、もう一度問いを置く。新しい商談は作らない
prepRoutes.post("/preps/:id/retry", async (c) => {
  const db = c.env.DB;
  const p = await loadPrep(db, c.req.param("id"), c.get("user"));
  if (!p) return c.json({ error: "準備が見つかりません" }, 404);
  if (p.stage === "opening") return c.json({ error: "先に、バイヤーの問いを受けてください" }, 409);
  if (!preparedEnough(p)) return c.json({ error: `返しを${MIN_RETURNS}本以上と、落としどころを書いてください` }, 400);
  if (p.stage !== "retry") {
    await db.batch([
      db.prepare("INSERT INTO practice_messages (session_id, role, content) VALUES (?, 'buyer', ?)").bind(p.session_id, RETRY_LINE),
      db.prepare("UPDATE preps SET stage = 'retry', round_turns = 0, updated_at = datetime('now') WHERE id = ?").bind(p.id),
    ]);
  }
  return c.json(await prepView(db, (await loadPrep(db, p.id, c.get("user")))!, c.get("user")));
});

// 上司への相談文。返しと落としどころはそのまま写し、Claude は要約と確かめたいことだけを書く
prepRoutes.post("/preps/:id/consult", async (c) => {
  const db = c.env.DB;
  const p = await loadPrep(db, c.req.param("id"), c.get("user"));
  if (!p) return c.json({ error: "準備が見つかりません" }, 404);
  if (!preparedEnough(p)) return c.json({ error: `返しを${MIN_RETURNS}本以上と、落としどころを書いてください` }, 400);
  const key = c.env.ANTHROPIC_API_KEY;
  if (!key) return c.json({ error: "API キーが設定されていません" }, 503);
  const found = (await loadBuyer(db, p.buyer_id, c.get("user").company_id))!;
  const candidates = shelfCandidates(await loadShelf(db, found.account.id)).map(({ name, maker, is_own, facings, weekly_units, yoy_pct }) => ({
    name, maker, is_own, facings, weekly_units, yoy_pct,
  }));
  const returns = returnsOf(p);
  const occasion = await occasionName(db, p.occasion_id);
  const draft = await writeConsult(key, { goal: p.goal, occasion, gainAnswer: p.gain_answer, returns, landing: p.landing, candidates });
  const consult = { goal: p.goal, occasion, gainAnswer: p.gain_answer, returns, landing: p.landing, ...draft };
  // 書き直した1枚は、まだ上司に出していない
  await db.prepare("UPDATE preps SET consult_json = ?, submitted_at = '', reply_json = ?, updated_at = datetime('now') WHERE id = ?").bind(JSON.stringify(consult), staleReply(p.reply_json), p.id).run();
  return c.json(await prepView(db, (await loadPrep(db, p.id, c.get("user")))!, c.get("user")));
});

// 上司に出す。押すまで上司には何も見えない
prepRoutes.post("/preps/:id/consult/send", async (c) => {
  const db = c.env.DB;
  const me = c.get("user");
  const p = await loadPrep(db, c.req.param("id"), me);
  if (!p) return c.json({ error: "準備が見つかりません" }, 404);
  if (!p.consult_json) return c.json({ error: "先に相談文を作ってください" }, 409);
  if (!me.manager_id) return c.json({ error: "相談文を届ける上司が設定されていません" }, 409);
  await db.prepare("UPDATE preps SET submitted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(p.id).run();
  return c.json(await prepView(db, (await loadPrep(db, p.id, me))!, me));
});

// 相手と時期の下調べ：承認済みの関心・確定した商談の傾向・商談日から見た行事だけを返す
prepRoutes.get("/preps/:id/brief", async (c) => {
  const p = await loadPrep(c.env.DB, c.req.param("id"), c.get("user"));
  if (!p) return c.json({ error: "準備が見つかりません" }, 404);
  const found = await loadBuyer(c.env.DB, p.buyer_id, c.get("user").company_id);
  if (!found) return c.json({ error: "準備が見つかりません" }, 404);
  // POS は画面にだけ返す。Claude への入力（briefOf の先）には入れない
  return c.json({ ...(await briefOf(c.env.DB, p, found)), pos: await loadPos(c.env.DB, found.account.id, p.meeting_on) });
});

// 相手の情報：どの段階からでも開く1枚。本人の準備の相手の分だけを返す
prepRoutes.get("/preps/:id/partner", async (c) => {
  const p = await loadPrep(c.env.DB, c.req.param("id"), c.get("user"));
  if (!p) return c.json({ error: "準備が見つかりません" }, 404);
  const found = await loadBuyer(c.env.DB, p.buyer_id, c.get("user").company_id);
  if (!found) return c.json({ error: "準備が見つかりません" }, 404);
  return c.json(await prepPartner(c.env.DB, found.buyer, found.account, p.meeting_on));
});

// 前回の続き：確定した商談の約束と施策の結果だけを出す。結果が悪ければ原因の仮説を問う
prepRoutes.get("/preps/:id/recap", async (c) => {
  const db = c.env.DB;
  const p = await loadPrep(db, c.req.param("id"), c.get("user"));
  if (!p) return c.json({ error: "準備が見つかりません" }, 404);
  const [meeting, promises, results] = await Promise.all([
    db.prepare("SELECT held_on, kind, summary FROM meetings WHERE buyer_id = ? AND status = 'confirmed' ORDER BY held_on DESC LIMIT 1")
      .bind(p.buyer_id).first<{ held_on: string; kind: string; summary: string }>(),
    confirmedPromises(db, p.buyer_id),
    confirmedResults(db, p.buyer_id),
  ]);
  return c.json({ meeting, promises, results, askCause: results.some((r) => r.outcome === "bad") });
});
