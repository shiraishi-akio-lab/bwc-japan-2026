import Anthropic from "@anthropic-ai/sdk";
import { Hono } from "hono";
import { loadAccount, type Account } from "./accounts";
import type { AppEnv } from "./types";

type Label = { type: "meeting" | "priority" | "promise"; id: string };
type Evaluation = { iteration: number; result: string; explanation: string };
type Handoff = {
  id: string; account_id: string; from_rep: string; to_rep: string; session_id: string; labels_json: string;
  status: "running" | "passed" | "unpassed" | "failed"; content: string; evaluations_json: string; created_at: string;
};

const OUTPUT = "handoff.md";
const MAX_ITERATIONS = 3;
const BUDGET_CENTS = "200"; // 1回の上限 $2。試験では $0.66 だった
const TIMEOUT_MS = 10 * 60 * 1000;
const MAX_NAME = 40;
const FINISHED = ["satisfied", "max_iterations_reached", "failed", "interrupted"];

const RUBRIC = `# 引き継ぎ書の基準
- /mnt/session/outputs/${OUTPUT} が1つある
- 事実の記述すべてに、根拠のラベルが同じ行に [M1] の形で書かれている
- 渡された記録に無いことを事実として書いていない。推測は行頭に「推測：」と書いている
- 未完了の約束がすべて載り、期限が書かれている。期限が無いものは「期限なし」と書いている
- 完了した約束を未完了として書いていない
- 新しい記録と食い違う古い記録は、今は違うと分かるように書いている
- 異動した担当者の記録と現役の担当者の記録を混ぜていない
- 「次の商談で最初に確かめること」が3つ以内で書かれている
- 入社2年目の営業が読める平易な日本語で、2,500字以内である
`;

const brief = (fromRep: string, toRep: string, accountName: string, record: string) =>
  `${accountName}の担当が${fromRep}から${toRep}に替わります。下の記録を読み、${toRep}に向けた引き継ぎ書を日本語で作り、/mnt/session/outputs/${OUTPUT} に保存してください。

見出しはこの順にします。
## 次の商談で最初に確かめること
## 未完了の約束
## 相手が今大事にしていること
## これまでの流れ
## 気をつけたい点

M・P・T で始まるラベルが根拠です。

${record}`;

// AI に渡すのは人が確定した記録だけ。バイヤー役の設定（persona）は渡さない
async function buildRecord(db: D1Database, account: Account) {
  const [meetings, priorities, promises] = await Promise.all([
    db.prepare(
      `SELECT m.id, m.held_on, m.kind, m.participants, m.summary, m.decisions_json, m.open_issues_json, b.name AS buyer, b.status AS buyer_status
       FROM meetings m JOIN buyers b ON b.id = m.buyer_id WHERE m.account_id = ? AND m.status = 'confirmed' ORDER BY m.held_on LIMIT 50`,
    ).bind(account.id).all<{ id: string; held_on: string; kind: string; participants: string; summary: string; decisions_json: string; open_issues_json: string; buyer: string; buyer_status: string }>(),
    db.prepare(
      `SELECT p.id, p.text, p.basis, p.noted_on, b.name AS buyer FROM priorities p JOIN buyers b ON b.id = p.buyer_id
       WHERE b.account_id = ? AND p.status = 'approved' ORDER BY p.noted_on`,
    ).bind(account.id).all<{ id: string; text: string; basis: string; noted_on: string; buyer: string }>(),
    db.prepare(
      `SELECT p.id, p.text, p.due, p.done, m.held_on FROM promises p JOIN meetings m ON m.id = p.meeting_id
       WHERE m.account_id = ? AND m.status = 'confirmed' ORDER BY m.held_on`,
    ).bind(account.id).all<{ id: string; text: string; due: string; done: number; held_on: string }>(),
  ]);
  const labels: Record<string, Label> = {};
  const tag = (prefix: string, type: Label["type"], id: string, i: number) => {
    labels[`${prefix}${i + 1}`] = { type, id };
    return `${prefix}${i + 1}`;
  };
  const record = JSON.stringify({
    取引先: { 名前: account.name, 業態: account.format, 店舗数: account.stores, 概要: account.profile, 決まりごと: account.rules },
    議事録: meetings.results.map((m, i) => ({
      ラベル: tag("M", "meeting", m.id, i), 日付: m.held_on, 種類: m.kind, 相手: m.buyer, 相手の状態: m.buyer_status, 参加者: m.participants,
      要約: m.summary, 決定事項: JSON.parse(m.decisions_json), 残った論点: JSON.parse(m.open_issues_json),
    })),
    今大事にしていること: priorities.results.map((p, i) => ({ ラベル: tag("P", "priority", p.id, i), 日付: p.noted_on, 相手: p.buyer, 内容: p.text, 根拠: p.basis })),
    約束: promises.results.map((p, i) => ({ ラベル: tag("T", "promise", p.id, i), 内容: p.text, 期限: p.due, 状態: p.done ? "完了" : "未完了", 議事録の日付: p.held_on })),
  }, null, 1);
  return { record, labels, meetingCount: meetings.results.length };
}

// 本文の中のラベルが、渡した記録に本当にあるかをコードで確かめる
export const unknownLabels = (content: string, labels: Record<string, Label>) =>
  [...new Set(content.match(/\b[MPT]\d+\b/g) ?? [])].filter((l) => !labels[l]);

const publicHandoff = ({ labels_json, evaluations_json, session_id: _session, ...h }: Handoff) => {
  const labels = JSON.parse(labels_json) as Record<string, Label>;
  return { ...h, labels, evaluations: JSON.parse(evaluations_json) as Evaluation[], unknownLabels: unknownLabels(h.content, labels) };
};

const graderText = (s: string) => s.replace(/^An independent grader found[^\n]*\n*/, "").trim();

async function downloadOutput(client: Anthropic, sessionId: string) {
  const files = await client.beta.files.list({ scope_id: sessionId, betas: ["managed-agents-2026-04-01"] });
  const file = files.data.find((f) => f.filename.endsWith(OUTPUT));
  return file ? (await client.beta.files.download(file.id)).text() : "";
}

// 画面が聞きに来るたびに、セッションの進み具合を読む
async function refresh(db: D1Database, apiKey: string, h: Handoff) {
  const client = new Anthropic({ apiKey });
  const session = await client.beta.sessions.retrieve(h.session_id);
  const evaluations: Evaluation[] = [];
  let grading = false;
  for await (const e of client.beta.sessions.events.list(h.session_id)) {
    if (e.type === "span.outcome_evaluation_start") grading = true;
    if (e.type === "span.outcome_evaluation_end") {
      grading = false;
      evaluations.push({ iteration: e.iteration, result: e.result, explanation: graderText(e.explanation ?? "") });
    }
  }
  const last = evaluations.at(-1);
  const finished = session.status === "idle" && !!last && FINISHED.includes(last.result);
  const timedOut = Date.now() - Date.parse(`${h.created_at.replace(" ", "T")}Z`) > TIMEOUT_MS;
  let status = h.status;
  let content = "";
  if (finished) {
    content = await downloadOutput(client, h.session_id);
    if (content) status = last.result === "satisfied" ? "passed" : "unpassed";
  }
  if (session.status === "terminated" || (timedOut && status === "running")) status = "failed";
  await db.prepare("UPDATE handoffs SET status = ?, content = ?, evaluations_json = ? WHERE id = ?")
    .bind(status, content, JSON.stringify(evaluations), h.id).run();
  return { ...h, status, content, evaluations_json: JSON.stringify(evaluations), grading };
}

export const handoffRoutes = new Hono<AppEnv>();

// 引き継ぎ書を作れる環境かどうか。公開版では止めているので、画面はこれを見て入力欄を出さない
handoffRoutes.get("/handoff-ready", (c) => c.json({ ready: !!(c.env.ANTHROPIC_API_KEY && c.env.HANDOFF_AGENT_ID && c.env.HANDOFF_ENV_ID) }));

handoffRoutes.get("/accounts/:id/handoffs", async (c) => {
  const account = await loadAccount(c.env.DB, c.req.param("id"), c.get("user").company_id);
  if (!account) return c.json({ error: "取引先が見つかりません" }, 404);
  const { results } = await c.env.DB.prepare(
    "SELECT id, from_rep, to_rep, status, created_at FROM handoffs WHERE account_id = ? ORDER BY created_at DESC",
  ).bind(account.id).all();
  return c.json(results);
});

handoffRoutes.post("/accounts/:id/handoffs", async (c) => {
  const { ANTHROPIC_API_KEY: apiKey, HANDOFF_AGENT_ID: agent, HANDOFF_ENV_ID: environmentId } = c.env;
  if (!apiKey) return c.json({ error: "API キーが設定されていません" }, 503);
  if (!agent || !environmentId) return c.json({ error: "公開版では、引き継ぎ書の作成を止めています" }, 503);
  const id = c.req.param("id");
  const account = await loadAccount(c.env.DB, id, c.get("user").company_id);
  if (!account) return c.json({ error: "取引先が見つかりません" }, 404);
  const { toRep } = await c.req.json<{ toRep?: string }>();
  const to = (toRep ?? "").trim().slice(0, MAX_NAME);
  if (!to) return c.json({ error: "引き継ぐ人を入れてください" }, 400);
  if (to === account.owner_rep) return c.json({ error: "今の担当と同じ人です" }, 400);
  const running = await c.env.DB.prepare("SELECT id FROM handoffs WHERE account_id = ? AND status = 'running'").bind(id).first<{ id: string }>();
  if (running) return c.json({ id: running.id });

  const { record, labels, meetingCount } = await buildRecord(c.env.DB, account);
  if (meetingCount === 0) return c.json({ error: "確定した議事録がまだありません" }, 409);
  const client = new Anthropic({ apiKey });
  const session = await client.beta.sessions.create({
    agent,
    environment_id: environmentId,
    title: `${account.name}の引き継ぎ`,
    budget: { type: "limit", max_list_cost: { amount: BUDGET_CENTS, currency: "USD" } },
  });
  await client.beta.sessions.events.send(session.id, {
    events: [{
      type: "user.define_outcome",
      description: brief(account.owner_rep, to, account.name, record),
      rubric: { type: "text", content: RUBRIC },
      max_iterations: MAX_ITERATIONS,
    }],
  });
  const handoffId = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO handoffs (id, account_id, from_rep, to_rep, session_id, labels_json) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(handoffId, id, account.owner_rep, to, session.id, JSON.stringify(labels)).run();
  return c.json({ id: handoffId });
});

handoffRoutes.get("/handoffs/:id", async (c) => {
  const h = await c.env.DB.prepare(
    `SELECT h.id, h.account_id, h.from_rep, h.to_rep, h.session_id, h.labels_json, h.status, h.content, h.evaluations_json, h.created_at
     FROM handoffs h JOIN accounts a ON a.id = h.account_id WHERE h.id = ? AND a.company_id = ?`,
  ).bind(c.req.param("id"), c.get("user").company_id).first<Handoff>();
  if (!h) return c.json({ error: "引き継ぎ書が見つかりません" }, 404);
  const key = c.env.ANTHROPIC_API_KEY;
  const { grading = false, ...row } = h.status === "running" && key ? await refresh(c.env.DB, key, h) : { ...h, grading: false };
  const { results: buyers } = await c.env.DB.prepare("SELECT id, name FROM buyers WHERE account_id = ? AND status = '現役'").bind(h.account_id).all();
  return c.json({ ...publicHandoff(row), grading, buyers });
});
