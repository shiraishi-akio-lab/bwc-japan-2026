import { Hono } from "hono";
import { organize, type CardDraft } from "./claude";
import { hit } from "./auth";
import type { AppEnv, AxisId, CaseCard } from "./types";

// 上司の画面：届いた相談文を読む・カードの候補を承認する・過去の商談や資料を取り込む
const MIN_STORY = 40;
const MAX_STORY = 4000;
const DRAFTS_PER_HOUR = 20;
const HOUR = 3600;

const cardId = (rowId: string) => `draft-${rowId.slice(0, 8)}`;

// 人が承認した候補は、カード（Markdown の正本）と同じ形で根拠に使う。読むのは自分の会社の分だけ
export const companyCards = async (db: D1Database, companyId: string): Promise<CaseCard[]> => {
  const { results } = await db.prepare(
    "SELECT id, card_json FROM case_drafts WHERE company_id = ? AND status = 'approved' ORDER BY created_at DESC, id",
  ).bind(companyId).all<{ id: string; card_json: string }>();
  return results.map(({ id, card_json }) => {
    const { questionsForVeteran: _questions, ...card } = JSON.parse(card_json) as CardDraft;
    return { ...card, axes: card.axes as AxisId[], id: cardId(id), status: "approved", author: "取り込んだ語りを整理し、上司が承認した" };
  });
};

export const managerRoutes = new Hono<AppEnv>();

// 部下が「上司に出す」を押した1枚だけ。発言・5軸・メモ・次の一行動のテーブルには触らない
managerRoutes.get("/consults", async (c) => {
  const me = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.meeting_on, p.submitted_at, p.consult_json, p.reply_json, u.display_name AS rep_name, b.name AS buyer_name, a.name AS account_name
     FROM preps p JOIN users u ON u.id = p.user_id JOIN buyers b ON b.id = p.buyer_id JOIN accounts a ON a.id = b.account_id
     WHERE u.manager_id = ? AND u.company_id = ? AND a.company_id = ? AND p.submitted_at != '' AND p.consult_json != ''
     ORDER BY p.submitted_at DESC`,
  ).bind(me.id, me.company_id, me.company_id)
    .all<{ id: string; meeting_on: string; submitted_at: string; consult_json: string; reply_json: string; rep_name: string; buyer_name: string; account_name: string }>();
  return c.json(results.map(({ consult_json, reply_json, ...r }) => {
    const reply = reply_json ? (JSON.parse(reply_json) as { stale?: boolean }) : null;
    const { goal, occasion, summary, gainAnswer, returns, concessions, landing, asks } = JSON.parse(consult_json) as Record<string, unknown>;
    return { id: r.id, repName: r.rep_name, buyerName: r.buyer_name, accountName: r.account_name, meetingOn: r.meeting_on, submittedAt: r.submitted_at, reply: reply?.stale ? null : reply, goal, occasion, summary, gainAnswer, returns, concessions, landing, asks };
  }));
});

// 相談文への返事。自分の部下が出した1枚にだけ返せる。AI は使わない
const VERDICTS = ["go", "condition", "rethink"];
const MAX_REPLY = 300;
managerRoutes.post("/consults/:id/reply", async (c) => {
  const me = c.get("user");
  const found = await c.env.DB.prepare(
    "SELECT p.id FROM preps p JOIN users u ON u.id = p.user_id WHERE p.id = ? AND u.manager_id = ? AND u.company_id = ? AND p.submitted_at != ''",
  ).bind(c.req.param("id"), me.id, me.company_id).first();
  if (!found) return c.json({ error: "相談文が見つかりません" }, 404);
  const { verdict, comment } = await c.req.json<{ verdict?: string; comment?: string }>().catch(() => ({ verdict: "", comment: "" }));
  const text = (comment ?? "").trim();
  if (!verdict || !VERDICTS.includes(verdict)) return c.json({ error: "判断を選んでください" }, 400);
  if (!text || Array.from(text).length > MAX_REPLY) return c.json({ error: `一言は1〜${MAX_REPLY}字で書いてください` }, 400);
  const reply = { verdict, comment: text, repliedAt: new Date().toISOString() };
  await c.env.DB.prepare("UPDATE preps SET reply_json = ?, updated_at = datetime('now') WHERE id = ?").bind(JSON.stringify(reply), c.req.param("id")).run();
  return c.json(reply);
});

// 登録済みの商談から作るときの元の文。確定した商談だけを、自分の会社の中から読む
const meetingStory = async (db: D1Database, id: string, companyId: string) => {
  const m = await db.prepare(
    `SELECT m.held_on, m.kind, m.participants, m.summary, m.decisions_json, m.open_issues_json, n.notes
     FROM meetings m JOIN accounts a ON a.id = m.account_id LEFT JOIN meeting_notes n ON n.meeting_id = m.id
     WHERE m.id = ? AND m.status = 'confirmed' AND a.company_id = ?`,
  ).bind(id, companyId).first<{ held_on: string; kind: string; participants: string; summary: string; decisions_json: string; open_issues_json: string; notes: string | null }>();
  if (!m) return null;
  const list = (s: string) => (JSON.parse(s) as string[]).join("／");
  return [`${m.held_on} ${m.kind}（${m.participants}）`, `要約：${m.summary}`, `決定：${list(m.decisions_json)}`, `残った論点：${list(m.open_issues_json)}`, m.notes ? `メモ：${m.notes}` : ""].filter(Boolean).join("\n");
};

// 登録済みの商談の一覧。新しい順。メモの本文は返さない
managerRoutes.get("/drafts/meetings", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.held_on, m.kind, m.summary, a.name AS account_name, b.name AS buyer_name, n.meeting_id IS NOT NULL AS has_notes
     FROM meetings m JOIN accounts a ON a.id = m.account_id JOIN buyers b ON b.id = m.buyer_id LEFT JOIN meeting_notes n ON n.meeting_id = m.id
     WHERE m.status = 'confirmed' AND a.company_id = ? ORDER BY m.held_on DESC, m.id`,
  ).bind(c.get("user").company_id).all();
  return c.json(results);
});

// 取り込み：登録済みの商談・資料の文字 → カードの候補（pending）。ファイルは受け取らない
managerRoutes.post("/drafts", async (c) => {
  const key = c.env.ANTHROPIC_API_KEY;
  if (!key) return c.json({ error: "API キーが設定されていません" }, 503);
  const me = c.get("user");
  const { story, meetingId } = await c.req.json<{ story?: string; meetingId?: string }>();
  const fromMeeting = meetingId ? await meetingStory(c.env.DB, meetingId, me.company_id) : null;
  if (meetingId && !fromMeeting) return c.json({ error: "確定した商談が見つかりません" }, 404);
  const text = (fromMeeting ?? story ?? "").trim();
  const length = Array.from(text).length;
  if (length < MIN_STORY || length > MAX_STORY) return c.json({ error: `文字は${MIN_STORY}〜${MAX_STORY}字で貼ってください` }, 400);
  if (!(await hit(c.env.DB, `drafts:${me.id}`, DRAFTS_PER_HOUR, HOUR))) return c.json({ error: "取り込みの回数の上限です。しばらくしてからやり直してください" }, 429);

  const draft = await organize(key, text);
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO case_drafts (id, source_text, card_json, company_id, user_id) VALUES (?, ?, ?, ?, ?)")
    .bind(id, text, JSON.stringify(draft), me.company_id, me.id)
    .run();
  return c.json({ id, draft });
});

managerRoutes.get("/drafts", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, card_json, created_at FROM case_drafts WHERE company_id = ? AND status = 'pending' ORDER BY created_at DESC, id",
  ).bind(c.get("user").company_id).all<{ id: string; card_json: string; created_at: string }>();
  return c.json(results.map(({ id, card_json, created_at }) => ({ id, createdAt: created_at, card: JSON.parse(card_json) as CardDraft })));
});

// カードの候補を人が承認・見送りする
managerRoutes.post("/drafts/:id", async (c) => {
  const { status } = await c.req.json<{ status?: string }>();
  if (status !== "approved" && status !== "rejected") return c.json({ error: "承認か見送りを選んでください" }, 400);
  const r = await c.env.DB.prepare("UPDATE case_drafts SET status = ? WHERE id = ? AND company_id = ?")
    .bind(status, c.req.param("id"), c.get("user").company_id).run();
  if (r.meta.changes === 0) return c.json({ error: "候補が見つかりません" }, 404);
  return c.json({ ok: true });
});
