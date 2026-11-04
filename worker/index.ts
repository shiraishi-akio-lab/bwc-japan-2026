import { Hono } from "hono";
import rubric from "../data/rubric.json";
import { accountRoutes, buildRecord, buyerPersona, loadBuyer } from "./accounts";
import { buyerOpening, buyerReply, check, decideNext, draftMinutes, organize, selectCards, splitTranscript, type Turn } from "./claude";
import { approvedCases, cases } from "./data";

type Bindings = { DB: D1Database; ANTHROPIC_API_KEY?: string };

const MAX_REP_TURNS = 8; // 練習は5分程度。長い雑談にしない
const MAX_TEXT = 600;
const MAX_TRANSCRIPT = 20000; // 30分ほどの商談まで
const RECORDING = "recording"; // 本番の商談の文字起こしから作った振り返り
const DEFAULT_BUYER = "buyer-saeki";

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

app.route("/api", accountRoutes);

// 練習の相手と、取引先の記録を使うかどうか。記録の無い練習は比べるためにも残す
const loadSessionRecord = async (db: D1Database, sessionId: string) => {
  const s = await db.prepare("SELECT scenario_id, buyer_id, use_record FROM practice_sessions WHERE id = ?")
    .bind(sessionId)
    .first<{ scenario_id: string; buyer_id: string | null; use_record: number }>();
  if (!s) return null;
  const found = s.buyer_id ? await loadBuyer(db, s.buyer_id) : null;
  const record = found && s.use_record ? await buildRecord(db, found.buyer, found.account) : "";
  return { ...s, found, record };
};

app.post("/api/practice", async (c) => {
  const { buyerId = DEFAULT_BUYER, useRecord = true } = await c.req.json<{ buyerId?: string; useRecord?: boolean }>();
  const found = await loadBuyer(c.env.DB, buyerId);
  if (!found) return c.json({ error: "担当バイヤーが見つかりません" }, 404);
  const id = crypto.randomUUID();
  const opening = buyerOpening(found.buyer.name);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO practice_sessions (id, scenario_id, buyer_id, use_record) VALUES (?, ?, ?, ?)")
      .bind(id, "herb-soda-first-pitch", buyerId, useRecord ? 1 : 0),
    c.env.DB.prepare("INSERT INTO practice_messages (session_id, role, content) VALUES (?, 'buyer', ?)").bind(id, opening),
  ]);
  return c.json({ id, turns: [{ role: "buyer", content: opening }], buyerName: found.buyer.name });
});

app.post("/api/practice/:id/turn", async (c) => {
  const key = c.env.ANTHROPIC_API_KEY;
  if (!key) return c.json({ error: "API キーが設定されていません" }, 503);
  const id = c.req.param("id");
  const { text } = await c.req.json<{ text?: string }>();
  const said = (text ?? "").trim();
  if (!said || said.length > MAX_TEXT) return c.json({ error: `発言は1〜${MAX_TEXT}字で入力してください` }, 400);

  const session = await loadSessionRecord(c.env.DB, id);
  if (!session) return c.json({ error: "練習が見つかりません" }, 404);
  if (session.scenario_id === RECORDING) return c.json({ error: "本番の振り返りには、発言を足せません" }, 409);
  const turns = await loadTurns(c.env.DB, id);
  if (turns.filter((t) => t.role === "rep").length >= MAX_REP_TURNS) {
    return c.json({ error: "この練習は終わりです。メモを書いて振り返りに進んでください" }, 409);
  }

  const next: Turn[] = [...turns, { role: "rep", content: said }];
  if (!session.found) return c.json({ error: "この練習には相手が設定されていません" }, 409);
  const reply = await buyerReply(key, next, buyerPersona(session.found.buyer, session.found.account, session.record));
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
  const record = (await loadSessionRecord(c.env.DB, id))?.record ?? "";
  const picked = await selectCards(key, turns, approvedCases, record);
  const result = await check(key, turns, memo, picked, record);
  const next = await decideNext(key, turns, result, picked, record);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO memos (id, session_id, facts, interpretation, next_check) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), id, facts, interpretation, nextCheck),
    c.env.DB.prepare("INSERT INTO assessments (id, session_id, map_json, next_action_json) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), id, JSON.stringify(result), JSON.stringify(next)),
  ]);
  return c.json({ ...result, next });
});

// 本番の商談のあと：話者分け済みの文字起こしを貼る → 練習と同じ「確かめる → 次の一行動」に流す
// 録音そのものは受け取らない・保存しない
app.post("/api/recordings", async (c) => {
  const key = c.env.ANTHROPIC_API_KEY;
  if (!key) return c.json({ error: "API キーが設定されていません" }, 503);
  const { transcript, buyerId, heldOn } = await c.req.json<{ transcript?: string; buyerId?: string; heldOn?: string }>();
  const text = (transcript ?? "").trim();
  if (text.length < 40 || text.length > MAX_TRANSCRIPT) {
    return c.json({ error: `文字起こしは40〜${MAX_TRANSCRIPT}字で貼ってください` }, 400);
  }

  const found = buyerId ? await loadBuyer(c.env.DB, buyerId) : null;
  if (buyerId && !found) return c.json({ error: "担当バイヤーが見つかりません" }, 404);

  const turns = await splitTranscript(key, text);
  const id = crypto.randomUUID();
  const stmts = [
    c.env.DB.prepare("INSERT INTO practice_sessions (id, scenario_id, buyer_id) VALUES (?, ?, ?)").bind(id, RECORDING, buyerId ?? null),
    ...turns.map((t) =>
      c.env.DB.prepare("INSERT INTO practice_messages (session_id, role, content) VALUES (?, ?, ?)").bind(id, t.role, t.content),
    ),
  ];

  // 相手が分かっている商談は、議事録の下書きも作る。AI が読むのは人が確定してから
  let meetingId: string | null = null;
  if (found) {
    const m = await draftMinutes(key, turns);
    const held = heldOn && /^\d{4}-\d{2}-\d{2}$/.test(heldOn) ? heldOn : new Date().toISOString().slice(0, 10);
    meetingId = crypto.randomUUID();
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO meetings (id, account_id, buyer_id, session_id, held_on, kind, participants, summary, decisions_json, open_issues_json) VALUES (?, ?, ?, ?, ?, '商談', ?, ?, ?, ?)",
      ).bind(meetingId, found.account.id, found.buyer.id, id, held, `${found.buyer.name}／${found.account.owner_rep}`, m.summary, JSON.stringify(m.decisions), JSON.stringify(m.openIssues)),
      ...m.promises.map((p) =>
        c.env.DB.prepare("INSERT INTO promises (id, meeting_id, text, due) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), meetingId, p.text, p.due),
      ),
      ...m.priorities.map((p) =>
        c.env.DB.prepare("INSERT INTO priorities (id, buyer_id, meeting_id, text, basis, noted_on) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(crypto.randomUUID(), found.buyer.id, meetingId, p.text, p.basis, held),
      ),
    );
  }
  await c.env.DB.batch(stmts);
  return c.json({ id, turns, meetingId });
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
