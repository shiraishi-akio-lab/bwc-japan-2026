import { Hono } from "hono";
import type { AppEnv } from "./types";

export type Account = { id: string; name: string; format: string; stores: number; profile: string; rules: string; owner_rep: string; site_url: string };
export type Buyer = { id: string; account_id: string; name: string; role: string; status: string; persona: string };
type Meeting = {
  id: string; account_id: string; buyer_id: string; held_on: string; kind: string; participants: string;
  summary: string; decisions_json: string; open_issues_json: string; status: string; buyer_name?: string;
};

const MAX_FIELD = 2000;
const parseMeeting = ({ decisions_json, open_issues_json, ...m }: Meeting) => ({
  ...m,
  decisions: JSON.parse(decisions_json) as string[],
  openIssues: JSON.parse(open_issues_json) as string[],
});
// persona はバイヤー役だけが知っていること。画面には返さない
const publicBuyer = ({ persona: _persona, ...b }: Buyer) => b;

// 取引先は会社の範囲で引く。ほかの会社の id なら無いものとして扱う
export const loadAccount = (db: D1Database, id: string, companyId: string) =>
  db.prepare("SELECT id, name, format, stores, profile, rules, owner_rep, site_url FROM accounts WHERE id = ? AND company_id = ?")
    .bind(id, companyId).first<Account>();

export const loadBuyer = async (db: D1Database, buyerId: string, companyId: string) => {
  const buyer = await db.prepare("SELECT id, account_id, name, role, status, persona FROM buyers WHERE id = ?").bind(buyerId).first<Buyer>();
  if (!buyer) return null;
  const account = await loadAccount(db, buyer.account_id, companyId);
  return account ? { buyer, account } : null;
};

const IN_COMPANY = "m.account_id IN (SELECT id FROM accounts WHERE company_id = ?)";
const MEETING_COLS = "m.id, m.account_id, m.buyer_id, m.held_on, m.kind, m.participants, m.summary, m.decisions_json, m.open_issues_json, m.status";

export type InitiativeResult = { initiative: string; result: string; outcome: "good" | "bad"; held_on: string };

// 施策の結果。確定した商談の分だけを読む
export const confirmedResults = async (db: D1Database, buyerId: string): Promise<InitiativeResult[]> => {
  const { results } = await db.prepare(
    `SELECT r.initiative, r.result, r.outcome, m.held_on FROM initiative_results r
     JOIN meetings m ON m.id = r.meeting_id
     WHERE m.buyer_id = ? AND m.status = 'confirmed' ORDER BY m.held_on DESC`,
  ).bind(buyerId).all<InitiativeResult>();
  return results;
};

// AI に渡す取引先の記録。読むのは人が確定したものだけ
export async function buildRecord(db: D1Database, buyer: Buyer, account: Account): Promise<string> {
  const [pri, mtg, prm, res] = await Promise.all([
    db.prepare("SELECT text, basis, noted_on FROM priorities WHERE buyer_id = ? AND status = 'approved' ORDER BY noted_on DESC LIMIT 3")
      .bind(buyer.id).all<{ text: string; basis: string; noted_on: string }>(),
    db.prepare("SELECT held_on, kind, summary FROM meetings WHERE account_id = ? AND status = 'confirmed' ORDER BY held_on DESC LIMIT 3")
      .bind(account.id).all<{ held_on: string; kind: string; summary: string }>(),
    db.prepare("SELECT p.text, p.due FROM promises p JOIN meetings m ON m.id = p.meeting_id WHERE m.buyer_id = ? AND m.status = 'confirmed' AND p.done = 0")
      .bind(buyer.id).all<{ text: string; due: string }>(),
    confirmedResults(db, buyer.id),
  ]);
  const lines = [`取引先：${account.name}（${account.format}・${account.stores}店舗）`, `決まりごと：${account.rules}`, `相手：${buyer.name} ${buyer.role}`];
  if (pri.results.length) lines.push("今大事にしていること：", ...pri.results.map((p) => `- ${p.text}（${p.noted_on}・${p.basis}）`));
  if (mtg.results.length) lines.push("最近の商談：", ...mtg.results.map((m) => `- ${m.held_on} ${m.kind}：${m.summary}`));
  if (prm.results.length) lines.push("次回の約束：", ...prm.results.map((p) => `- ${p.text}${p.due ? `（${p.due}まで）` : ""}`));
  if (res.length) lines.push("やった施策の結果：", ...res.map((r) => `- ${r.held_on} ${r.initiative}：${r.result}`));
  return lines.join("\n");
}

// バイヤー役に渡す設定。use_record が無ければ会社の概要と本人の設定だけ
export const buyerPersona = (buyer: Buyer, account: Account, record: string) =>
  [
    `## 演じる相手\n${account.name}の${buyer.role}、${buyer.name}。`,
    `## 会社\n${account.profile}\n${account.rules}`,
    `## 自分からは言わないこと\n${buyer.persona}`,
    record ? `## これまでの記録\n${record}` : "",
  ].filter(Boolean).join("\n\n");

export const accountRoutes = new Hono<AppEnv>();

accountRoutes.get("/accounts", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.name, a.format, a.stores, a.owner_rep,
       (SELECT COUNT(*) FROM buyers b WHERE b.account_id = a.id AND b.status = '現役') AS buyer_count,
       (SELECT MAX(held_on) FROM meetings m WHERE m.account_id = a.id) AS last_met
     FROM accounts a WHERE a.company_id = ? ORDER BY a.name`,
  ).bind(c.get("user").company_id).all();
  return c.json(results);
});

accountRoutes.get("/buyers", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT b.id, b.name, b.role, b.status, a.name AS account_name FROM buyers b JOIN accounts a ON a.id = b.account_id WHERE b.status = '現役' AND a.company_id = ? ORDER BY a.name",
  ).bind(c.get("user").company_id).all();
  return c.json(results);
});

accountRoutes.get("/accounts/:id", async (c) => {
  const id = c.req.param("id");
  const account = await loadAccount(c.env.DB, id, c.get("user").company_id);
  if (!account) return c.json({ error: "取引先が見つかりません" }, 404);
  const [buyers, meetings] = await Promise.all([
    c.env.DB.prepare("SELECT id, account_id, name, role, status FROM buyers WHERE account_id = ? ORDER BY status, name").bind(id).all(),
    c.env.DB.prepare(
      `SELECT ${MEETING_COLS}, b.name AS buyer_name FROM meetings m JOIN buyers b ON b.id = m.buyer_id WHERE m.account_id = ? ORDER BY m.held_on DESC`,
    ).bind(id).all<Meeting>(),
  ]);
  return c.json({ account, buyers: buyers.results, meetings: meetings.results.map(parseMeeting) });
});

accountRoutes.get("/buyers/:id", async (c) => {
  const id = c.req.param("id");
  const found = await loadBuyer(c.env.DB, id, c.get("user").company_id);
  if (!found) return c.json({ error: "担当バイヤーが見つかりません" }, 404);
  const [priorities, promises] = await Promise.all([
    c.env.DB.prepare("SELECT id, text, basis, noted_on, status FROM priorities WHERE buyer_id = ? AND status != 'rejected' ORDER BY noted_on DESC").bind(id).all(),
    c.env.DB.prepare(
      "SELECT p.id, p.text, p.due, p.done, m.held_on, m.status AS meeting_status FROM promises p JOIN meetings m ON m.id = p.meeting_id WHERE m.buyer_id = ? ORDER BY p.done, m.held_on DESC",
    ).bind(id).all(),
  ]);
  return c.json({ buyer: publicBuyer(found.buyer), account: found.account, priorities: priorities.results, promises: promises.results });
});

accountRoutes.get("/meetings/:id", async (c) => {
  const id = c.req.param("id");
  const m = await c.env.DB.prepare(
    `SELECT ${MEETING_COLS}, b.name AS buyer_name FROM meetings m JOIN buyers b ON b.id = m.buyer_id WHERE m.id = ? AND ${IN_COMPANY}`,
  ).bind(id, c.get("user").company_id).first<Meeting>();
  if (!m) return c.json({ error: "議事録が見つかりません" }, 404);
  const [promises, priorities] = await Promise.all([
    c.env.DB.prepare("SELECT id, text, due, done FROM promises WHERE meeting_id = ? ORDER BY created_at").bind(id).all(),
    c.env.DB.prepare("SELECT id, text, basis, noted_on, status FROM priorities WHERE meeting_id = ? AND status != 'rejected' ORDER BY created_at").bind(id).all(),
  ]);
  return c.json({ ...parseMeeting(m), promises: promises.results, priorities: priorities.results });
});

type MeetingBody = {
  buyerId?: string; heldOn?: string; kind?: string; participants?: string; summary?: string;
  decisions?: string[]; openIssues?: string[]; promises?: { text: string; due: string }[]; confirm?: boolean;
};
const clean = (list?: string[]) => (list ?? []).map((s) => s.trim().slice(0, MAX_FIELD)).filter(Boolean);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// 録音が無い商談は、議事録を手で書いて残す
accountRoutes.post("/meetings", async (c) => {
  const b = await c.req.json<MeetingBody>();
  const found = b.buyerId ? await loadBuyer(c.env.DB, b.buyerId, c.get("user").company_id) : null;
  if (!found) return c.json({ error: "担当バイヤーを選んでください" }, 400);
  if (!b.heldOn || !isDate(b.heldOn)) return c.json({ error: "日付を入れてください" }, 400);
  const summary = (b.summary ?? "").trim().slice(0, MAX_FIELD);
  if (!summary) return c.json({ error: "要約を入れてください" }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO meetings (id, account_id, buyer_id, held_on, kind, participants, summary, decisions_json, open_issues_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(id, found.account.id, found.buyer.id, b.heldOn, (b.kind ?? "商談").slice(0, 40), (b.participants ?? "").slice(0, 200), summary,
    JSON.stringify(clean(b.decisions)), JSON.stringify(clean(b.openIssues))).run();
  return c.json({ id });
});

// 議事録を直す・確定する。AI が読むようになる確定と、確定後の修正は上司だけ
accountRoutes.patch("/meetings/:id", async (c) => {
  const id = c.req.param("id");
  const me = c.get("user");
  const b = await c.req.json<MeetingBody>();
  const m = await c.env.DB.prepare(`SELECT m.id, m.status FROM meetings m WHERE m.id = ? AND ${IN_COMPANY}`).bind(id, me.company_id).first<{ id: string; status: string }>();
  if (!m) return c.json({ error: "議事録が見つかりません" }, 404);
  if (me.role !== "manager" && (b.confirm || m.status === "confirmed")) return c.json({ error: "確定は上司の操作です" }, 403);
  const stmts = [
    c.env.DB.prepare("UPDATE meetings SET participants = ?, summary = ?, decisions_json = ?, open_issues_json = ?, status = ? WHERE id = ?")
      .bind((b.participants ?? "").slice(0, 200), (b.summary ?? "").trim().slice(0, MAX_FIELD), JSON.stringify(clean(b.decisions)),
        JSON.stringify(clean(b.openIssues)), b.confirm ? "confirmed" : m.status, id),
  ];
  if (b.promises) {
    stmts.push(c.env.DB.prepare("DELETE FROM promises WHERE meeting_id = ? AND done = 0").bind(id));
    for (const p of b.promises.filter((p) => p.text.trim())) {
      stmts.push(c.env.DB.prepare("INSERT INTO promises (id, meeting_id, text, due) VALUES (?, ?, ?, ?)")
        .bind(crypto.randomUUID(), id, p.text.trim().slice(0, MAX_FIELD), (p.due ?? "").slice(0, 40)));
    }
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

// 「今大事にしていること」の候補を人が承認・却下する
accountRoutes.post("/priorities/:id", async (c) => {
  const { status } = await c.req.json<{ status?: string }>();
  if (status !== "approved" && status !== "rejected") return c.json({ error: "承認か却下を選んでください" }, 400);
  const r = await c.env.DB.prepare(
    "UPDATE priorities SET status = ? WHERE id = ? AND buyer_id IN (SELECT b.id FROM buyers b JOIN accounts a ON a.id = b.account_id WHERE a.company_id = ?)",
  ).bind(status, c.req.param("id"), c.get("user").company_id).run();
  if (r.meta.changes === 0) return c.json({ error: "候補が見つかりません" }, 404);
  return c.json({ ok: true });
});

accountRoutes.post("/promises/:id", async (c) => {
  const me = c.get("user");
  const { done } = await c.req.json<{ done?: boolean }>();
  const found = await c.env.DB.prepare(
    "SELECT p.id, m.status FROM promises p JOIN meetings m ON m.id = p.meeting_id JOIN accounts a ON a.id = m.account_id WHERE p.id = ? AND a.company_id = ?",
  ).bind(c.req.param("id"), me.company_id).first<{ id: string; status: string }>();
  if (!found) return c.json({ error: "約束が見つかりません" }, 404);
  // 完了の印が付いた約束は、確定のときに書き直されない。上司が見ていない文を確定に残さないよう、若手は確定済みの約束を完了にするだけ
  if (me.role !== "manager" && (found.status !== "confirmed" || !done)) return c.json({ error: "完了を付けられるのは確定した議事録の約束だけで、戻すのは上司の操作です" }, 403);
  await c.env.DB.prepare("UPDATE promises SET done = ? WHERE id = ?").bind(done ? 1 : 0, found.id).run();
  return c.json({ ok: true });
});
