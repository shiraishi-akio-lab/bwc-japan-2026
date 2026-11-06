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
    `SELECT p.id, p.meeting_on, p.submitted_at, p.consult_json, u.display_name AS rep_name, b.name AS buyer_name, a.name AS account_name
     FROM preps p JOIN users u ON u.id = p.user_id JOIN buyers b ON b.id = p.buyer_id JOIN accounts a ON a.id = b.account_id
     WHERE u.manager_id = ? AND u.company_id = ? AND a.company_id = ? AND p.submitted_at != '' AND p.consult_json != ''
     ORDER BY p.submitted_at DESC`,
  ).bind(me.id, me.company_id, me.company_id)
    .all<{ id: string; meeting_on: string; submitted_at: string; consult_json: string; rep_name: string; buyer_name: string; account_name: string }>();
  return c.json(results.map(({ consult_json, ...r }) => {
    const { summary, gainAnswer, returns, concessions, landing, asks } = JSON.parse(consult_json) as Record<string, unknown>;
    return { id: r.id, repName: r.rep_name, buyerName: r.buyer_name, accountName: r.account_name, meetingOn: r.meeting_on, submittedAt: r.submitted_at, summary, gainAnswer, returns, concessions, landing, asks };
  }));
});

// 取り込み：過去の商談内容・資料の文字 → カードの候補（pending）。ファイルは受け取らない
managerRoutes.post("/drafts", async (c) => {
  const key = c.env.ANTHROPIC_API_KEY;
  if (!key) return c.json({ error: "API キーが設定されていません" }, 503);
  const me = c.get("user");
  const { story } = await c.req.json<{ story?: string }>();
  const text = (story ?? "").trim();
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
