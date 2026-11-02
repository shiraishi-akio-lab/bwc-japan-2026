import { Hono } from "hono";
import rubric from "../data/rubric.json";
import { BUYER_OPENING, buyerReply, check, decideNext, organize, type Turn } from "./claude";
import { approvedCases, cases } from "./data";

type Bindings = { DB: D1Database; ANTHROPIC_API_KEY?: string };

const MAX_REP_TURNS = 8; // 練習は5分程度。長い雑談にしない
const MAX_TEXT = 600;

const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/health", (c) => c.json({ ok: true, rubricAxes: rubric.axes.length, cases: cases.length }));

app.get("/api/rubric", (c) => c.json(rubric.axes.map(({ id, name, question }) => ({ id, name, question }))));

const loadTurns = async (db: D1Database, sessionId: string): Promise<Turn[]> => {
  const { results } = await db
    .prepare("SELECT role, content FROM practice_messages WHERE session_id = ? ORDER BY id")
    .bind(sessionId)
    .all<Turn>();
  return results;
};

app.post("/api/practice", async (c) => {
  const id = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO practice_sessions (id, scenario_id) VALUES (?, ?)").bind(id, "herb-soda-first-pitch"),
    c.env.DB.prepare("INSERT INTO practice_messages (session_id, role, content) VALUES (?, 'buyer', ?)").bind(id, BUYER_OPENING),
  ]);
  return c.json({ id, turns: [{ role: "buyer", content: BUYER_OPENING }] });
});

app.post("/api/practice/:id/turn", async (c) => {
  const key = c.env.ANTHROPIC_API_KEY;
  if (!key) return c.json({ error: "API キーが設定されていません" }, 503);
  const id = c.req.param("id");
  const { text } = await c.req.json<{ text?: string }>();
  const said = (text ?? "").trim();
  if (!said || said.length > MAX_TEXT) return c.json({ error: `発言は1〜${MAX_TEXT}字で入力してください` }, 400);

  const turns = await loadTurns(c.env.DB, id);
  if (turns.length === 0) return c.json({ error: "練習が見つかりません" }, 404);
  if (turns.filter((t) => t.role === "rep").length >= MAX_REP_TURNS) {
    return c.json({ error: "この練習は終わりです。メモを書いて振り返りに進んでください" }, 409);
  }

  const next: Turn[] = [...turns, { role: "rep", content: said }];
  const reply = await buyerReply(key, next);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO practice_messages (session_id, role, content) VALUES (?, 'rep', ?)").bind(id, said),
    c.env.DB.prepare("INSERT INTO practice_messages (session_id, role, content) VALUES (?, 'buyer', ?)").bind(id, reply),
  ]);
  return c.json({ turns: [...next, { role: "buyer", content: reply }] });
});

app.post("/api/practice/:id/check", async (c) => {
  const key = c.env.ANTHROPIC_API_KEY;
  if (!key) return c.json({ error: "API キーが設定されていません" }, 503);
  const id = c.req.param("id");
  const { facts = "", interpretation = "", nextCheck = "" } = await c.req.json<{
    facts?: string;
    interpretation?: string;
    nextCheck?: string;
  }>();

  const turns = await loadTurns(c.env.DB, id);
  if (!turns.some((t) => t.role === "rep")) return c.json({ error: "練習の発言がまだありません" }, 400);

  const memo = [`事実：${facts}`, `解釈：${interpretation}`, `次に確かめること：${nextCheck}`].join("\n");
  const result = await check(key, turns, memo, approvedCases);
  const next = await decideNext(key, turns, result, approvedCases);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO memos (id, session_id, facts, interpretation, next_check) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), id, facts, interpretation, nextCheck),
    c.env.DB.prepare("INSERT INTO assessments (id, session_id, map_json, next_action_json) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), id, JSON.stringify(result), JSON.stringify(next)),
  ]);
  return c.json({ ...result, next });
});

// 整理する係：ベテランの語り → ケースカードの候補（pending）。承認は人が Obsidian で行う
app.post("/api/drafts", async (c) => {
  const key = c.env.ANTHROPIC_API_KEY;
  if (!key) return c.json({ error: "API キーが設定されていません" }, 503);
  const { story } = await c.req.json<{ story?: string }>();
  const text = (story ?? "").trim();
  if (text.length < 40 || text.length > 4000) return c.json({ error: "語りは40〜4000字で入力してください" }, 400);

  const draft = await organize(key, text);
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO case_drafts (id, source_text, card_json) VALUES (?, ?, ?)")
    .bind(id, text, JSON.stringify(draft))
    .run();
  return c.json({ id, draft });
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || "処理に失敗しました" }, 500);
});

export default app;
