import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import rubric from "../data/rubric.json";
import { accountRoutes, buildRecord, buyerPersona, loadBuyer } from "./accounts";
import { authRoutes, guard } from "./auth";
import { buyerOpening, buyerReply, check, decideNext, draftMinutes, selectCards, splitTranscript, type Turn } from "./claude";
import { coachBriefText, counterpartRoutes } from "./counterpart";
import { approvedCases, cases } from "./data";
import { handoffRoutes } from "./handoff";
import { companyCards, managerRoutes } from "./manager";
import { briefOfSession, loadTurns, PREP_SCENARIO, prepRoutes } from "./prep";
import type { AppEnv, SessionUser } from "./types";

const MAX_REP_TURNS = 8; // 練習は5分程度。長い雑談にしない
const MAX_TEXT = 600;
const MAX_TRANSCRIPT = 20000; // 30分ほどの商談まで
const RECORDING = "recording"; // 本番の商談の文字起こしから作った振り返り
const DEFAULT_BUYER = "buyer-saeki";
const MAX_BODY = 128 * 1024; // いちばん長い文字起こしが入る大きさ

const app = new Hono<AppEnv>();

// 全 /api は既定で要ログイン。例外と役割は worker/access.ts の表だけで決める
app.use("/api/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});
app.use("/api/*", guard);
app.use("/api/*", bodyLimit({ maxSize: MAX_BODY, onError: (c) => c.json({ error: "送る内容が大きすぎます" }, 413) }));

app.get("/api/health", (c) => c.json({ ok: true, rubricAxes: rubric.axes.length, cases: cases.length }));

app.get("/api/rubric", (c) => c.json(rubric.axes.map(({ id, name, question }) => ({ id, name, question }))));

app.route("/api", authRoutes);
app.route("/api", accountRoutes);
app.route("/api", handoffRoutes);
app.route("/api", prepRoutes);
app.route("/api", counterpartRoutes);
app.route("/api", managerRoutes);

// 練習の相手と、取引先の記録を使うかどうか。記録の無い練習は比べるためにも残す
// 本人の練習だけを開く。他人の id なら無いものとして扱う
const loadSessionRecord = async (db: D1Database, sessionId: string, me: SessionUser) => {
  const s = await db.prepare("SELECT scenario_id, buyer_id, use_record FROM practice_sessions WHERE id = ? AND user_id = ?")
    .bind(sessionId, me.id)
    .first<{ scenario_id: string; buyer_id: string | null; use_record: number }>();
  if (!s) return null;
  const found = s.buyer_id ? await loadBuyer(db, s.buyer_id, me.company_id) : null;
  const base = found && s.use_record ? await buildRecord(db, found.buyer, found.account) : "";
  // 準備室の練習は、相手と時期の下調べも読む
  const brief = found && s.scenario_id === PREP_SCENARIO ? await briefOfSession(db, sessionId, found) : null;
  const record = [base, brief ? coachBriefText(brief) : ""].filter(Boolean).join("\n");
  return { ...s, found, record };
};

app.post("/api/practice", async (c) => {
  const { buyerId = DEFAULT_BUYER, useRecord = true } = await c.req.json<{ buyerId?: string; useRecord?: boolean }>();
  const me = c.get("user");
  const found = await loadBuyer(c.env.DB, buyerId, me.company_id);
  if (!found) return c.json({ error: "担当バイヤーが見つかりません" }, 404);
  const id = crypto.randomUUID();
  const opening = buyerOpening(found.buyer.name);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO practice_sessions (id, scenario_id, buyer_id, use_record, user_id) VALUES (?, ?, ?, ?, ?)")
      .bind(id, "march-shelf-free", buyerId, useRecord ? 1 : 0, me.id),
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

  const session = await loadSessionRecord(c.env.DB, id, c.get("user"));
  if (!session) return c.json({ error: "練習が見つかりません" }, 404);
  if (session.scenario_id === RECORDING) return c.json({ error: "本番の振り返りには、発言を足せません" }, 409);
  if (session.scenario_id === PREP_SCENARIO) return c.json({ error: "準備室の練習は、準備室の画面から続けてください" }, 409);
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
  const me = c.get("user");
  const session = await loadSessionRecord(c.env.DB, id, me);
  if (!session) return c.json({ error: "練習が見つかりません" }, 404);
  const { facts = "", interpretation = "", nextCheck = "" } = await c.req.json<{
    facts?: string;
    interpretation?: string;
    nextCheck?: string;
  }>();

  const turns = await loadTurns(c.env.DB, id);
  if (!turns.some((t) => t.role === "rep")) return c.json({ error: "練習の発言がまだありません" }, 400);

  const memo = [`事実：${facts}`, `解釈：${interpretation}`, `次に確かめること：${nextCheck}`].join("\n");
  const record = session.record;
  const picked = await selectCards(key, turns, [...approvedCases, ...(await companyCards(c.env.DB, me.company_id))], record);
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

  const me = c.get("user");
  const found = buyerId ? await loadBuyer(c.env.DB, buyerId, me.company_id) : null;
  if (buyerId && !found) return c.json({ error: "担当バイヤーが見つかりません" }, 404);

  const turns = await splitTranscript(key, text);
  const id = crypto.randomUUID();
  const stmts = [
    c.env.DB.prepare("INSERT INTO practice_sessions (id, scenario_id, buyer_id, user_id) VALUES (?, ?, ?, ?)").bind(id, RECORDING, buyerId ?? null, me.id),
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

// 表にあって定義の無いルートと、表の無い入力の受け皿。中身の理由は応答に出さない
app.notFound((c) => c.json({ error: "見つかりません" }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "処理に失敗しました" }, 500);
});

export default app;
