import { useCallback, useEffect, useState } from "react";
import { HandoffPage, HandoffStart } from "./Handoff";

type AccountRow = { id: string; name: string; format: string; stores: number; owner_rep: string; buyer_count: number; last_met: string | null };
type Account = { id: string; name: string; format: string; stores: number; profile: string; rules: string; owner_rep: string };
type Buyer = { id: string; name: string; role: string; status: string };
type Meeting = {
  id: string; held_on: string; kind: string; participants: string; summary: string; status: string;
  decisions: string[]; openIssues: string[]; buyer_id: string; buyer_name: string;
};
type Priority = { id: string; text: string; basis: string; noted_on: string; status: string };
type Promise_ = { id: string; text: string; due: string; done: number; held_on?: string; meeting_status?: string };
type MeetingDetail = Meeting & { promises: Promise_[]; priorities: Priority[] };

// 取引先 → 担当バイヤー → 議事録 とたどる。view は今開いている階層
export type View =
  | { name: "list" }
  | { name: "account"; id: string }
  | { name: "buyer"; id: string }
  | { name: "meeting"; id: string }
  | { name: "newMeeting"; buyerId: string }
  | { name: "handoff"; id: string };

export async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}

export const box = { border: "1px solid #ddd", borderRadius: 8, padding: 12, margin: "8px 0" } as const;
export const link = { background: "none", border: "none", color: "#1a73e8", padding: 0, cursor: "pointer", font: "inherit", textAlign: "left" } as const;
const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

export function Accounts({ view, setView, onPractice }: { view: View; setView: (v: View) => void; onPractice: (buyerId: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <section>
      {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}
      {view.name !== "list" && <button style={link} onClick={() => setView({ name: "list" })}>← 取引先の一覧</button>}
      {view.name === "list" && <List setView={setView} onError={setError} />}
      {view.name === "account" && <AccountPage id={view.id} setView={setView} onError={setError} />}
      {view.name === "buyer" && <BuyerPage id={view.id} setView={setView} onError={setError} onPractice={onPractice} />}
      {view.name === "meeting" && <MeetingPage id={view.id} setView={setView} onError={setError} />}
      {view.name === "newMeeting" && <NewMeeting buyerId={view.buyerId} setView={setView} onError={setError} />}
      {view.name === "handoff" && <HandoffPage id={view.id} setView={setView} onError={setError} onPractice={onPractice} />}
    </section>
  );
}

type Nav = { setView: (v: View) => void; onError: (m: string | null) => void };

function List({ setView, onError }: Nav) {
  const [rows, setRows] = useState<AccountRow[]>([]);
  useEffect(() => {
    call<AccountRow[]>("/api/accounts").then(setRows).catch((e: Error) => onError(e.message));
  }, [onError]);
  return (
    <>
      <h2>取引先</h2>
      <p style={{ color: "#555" }}>相手のことを、取引先ごとに積み上げます。AI が読むのは、人が確定した記録だけです。（すべて架空）</p>
      {rows.map((a) => (
        <div key={a.id} style={box}>
          <button style={{ ...link, fontWeight: 600 }} onClick={() => setView({ name: "account", id: a.id })}>{a.name}</button>
          <div style={{ fontSize: 14, color: "#555" }}>
            {a.format}・{a.stores}店舗／担当営業 {a.owner_rep}／最後の商談 {a.last_met ?? "なし"}
          </div>
        </div>
      ))}
    </>
  );
}

function AccountPage({ id, setView, onError }: Nav & { id: string }) {
  const [data, setData] = useState<{ account: Account; buyers: Buyer[]; meetings: Meeting[] } | null>(null);
  useEffect(() => {
    call<{ account: Account; buyers: Buyer[]; meetings: Meeting[] }>(`/api/accounts/${id}`).then(setData).catch((e: Error) => onError(e.message));
  }, [id, onError]);
  if (!data) return null;
  const { account, buyers, meetings } = data;
  return (
    <>
      <h2>{account.name}</h2>
      <p style={{ margin: "0 0 4px" }}>{account.format}・{account.stores}店舗／担当営業 {account.owner_rep}</p>
      <p style={{ margin: "0 0 4px" }}>{account.profile}</p>
      <p style={{ color: "#555" }}>決まりごと：{account.rules}</p>
      <h3>担当バイヤー</h3>
      {buyers.map((b) => (
        <div key={b.id} style={box}>
          <button style={{ ...link, fontWeight: 600 }} onClick={() => setView({ name: "buyer", id: b.id })}>{b.name}</button>
          <span style={{ marginLeft: 8, fontSize: 13, color: b.status === "現役" ? "#137333" : "#777" }}>{b.status}</span>
          <div style={{ fontSize: 14, color: "#555" }}>{b.role}</div>
        </div>
      ))}
      <h3>商談の記録</h3>
      <MeetingList meetings={meetings} setView={setView} />
      <HandoffStart accountId={account.id} ownerRep={account.owner_rep} setView={setView} onError={onError} />
    </>
  );
}

function MeetingList({ meetings, setView }: { meetings: Meeting[]; setView: (v: View) => void }) {
  if (meetings.length === 0) return <p style={{ color: "#777" }}>まだ記録はありません。</p>;
  return (
    <>
      {meetings.map((m) => (
        <div key={m.id} style={box}>
          <button style={link} onClick={() => setView({ name: "meeting", id: m.id })}>{m.held_on} {m.kind}（{m.buyer_name}）</button>
          {m.status === "draft" && <span style={{ marginLeft: 8, fontSize: 13, color: "#b06000" }}>下書き</span>}
          <div style={{ fontSize: 14 }}>{m.summary}</div>
        </div>
      ))}
    </>
  );
}

function BuyerPage({ id, setView, onError, onPractice }: Nav & { id: string; onPractice: (buyerId: string) => void }) {
  type Data = { buyer: Buyer; account: Account; priorities: Priority[]; promises: Promise_[] };
  const [data, setData] = useState<Data | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const load = useCallback(async () => {
    try {
      const d = await call<Data>(`/api/buyers/${id}`);
      setData(d);
      const a = await call<{ meetings: Meeting[] }>(`/api/accounts/${d.account.id}`);
      setMeetings(a.meetings.filter((m) => m.buyer_id === id));
    } catch (e) {
      onError((e as Error).message);
    }
  }, [id, onError]);
  useEffect(() => { void load(); }, [load]);
  if (!data) return null;
  const { buyer, account, priorities, promises } = data;
  const judge = (pid: string, status: string) =>
    call(`/api/priorities/${pid}`, "POST", { status }).then(load).catch((e: Error) => onError(e.message));
  const toggle = (p: Promise_) =>
    call(`/api/promises/${p.id}`, "POST", { done: !p.done }).then(load).catch((e: Error) => onError(e.message));
  const approved = priorities.filter((p) => p.status === "approved");
  const pending = priorities.filter((p) => p.status === "pending");
  return (
    <>
      <h2>{buyer.name}<span style={{ marginLeft: 8, fontSize: 14, color: "#555" }}>{buyer.status}</span></h2>
      <p>{account.name}　{buyer.role}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {buyer.status === "現役" && <button onClick={() => onPractice(buyer.id)}>この相手で練習する</button>}
        <button onClick={() => setView({ name: "newMeeting", buyerId: buyer.id })}>議事録を書く</button>
        <button onClick={() => setView({ name: "account", id: account.id })}>取引先に戻る</button>
      </div>

      <h3>今大事にしていること</h3>
      {approved.length === 0 && <p style={{ color: "#777" }}>まだ記録はありません。</p>}
      {approved.map((p) => (
        <div key={p.id} style={box}>
          <strong>{p.text}</strong>
          <div style={{ fontSize: 14, color: "#555" }}>{p.noted_on}　根拠：{p.basis}</div>
        </div>
      ))}
      {pending.length > 0 && <h4>候補（承認すると AI が読みます）</h4>}
      {pending.map((p) => (
        <div key={p.id} style={{ ...box, borderColor: "#f0c36d" }}>
          {p.text}
          <div style={{ fontSize: 14, color: "#555" }}>{p.noted_on}　根拠：{p.basis}</div>
          <button onClick={() => judge(p.id, "approved")}>承認</button>{" "}
          <button onClick={() => judge(p.id, "rejected")}>却下</button>
        </div>
      ))}

      <h3>次回の約束</h3>
      {promises.length === 0 && <p style={{ color: "#777" }}>約束はありません。</p>}
      {promises.map((p) => (
        <label key={p.id} style={{ display: "block", margin: "4px 0" }}>
          <input type="checkbox" checked={!!p.done} onChange={() => toggle(p)} /> {p.text}{p.due && `（${p.due}まで）`}
          {p.meeting_status === "draft" && <small style={{ color: "#b06000" }}>（議事録が下書き）</small>}
        </label>
      ))}

      <h3>議事録</h3>
      <MeetingList meetings={meetings} setView={setView} />
    </>
  );
}

function MeetingPage({ id, setView, onError }: Nav & { id: string }) {
  const [m, setM] = useState<MeetingDetail | null>(null);
  const [form, setForm] = useState({ participants: "", summary: "", decisions: "", openIssues: "", promises: "" });
  const [saved, setSaved] = useState("");
  const load = useCallback(async () => {
    try {
      const d = await call<MeetingDetail>(`/api/meetings/${id}`);
      setM(d);
      setForm({
        participants: d.participants,
        summary: d.summary,
        decisions: d.decisions.join("\n"),
        openIssues: d.openIssues.join("\n"),
        promises: d.promises.filter((p) => !p.done).map((p) => (p.due ? `${p.text}｜${p.due}` : p.text)).join("\n"),
      });
    } catch (e) {
      onError((e as Error).message);
    }
  }, [id, onError]);
  useEffect(() => { void load(); }, [load]);
  if (!m) return null;

  const save = async (confirm: boolean) => {
    try {
      await call(`/api/meetings/${id}`, "PATCH", {
        participants: form.participants,
        summary: form.summary,
        decisions: lines(form.decisions),
        openIssues: lines(form.openIssues),
        promises: lines(form.promises).map((l) => {
          const [text, due = ""] = l.split("｜");
          return { text, due };
        }),
        confirm,
      });
      setSaved(confirm ? "確定しました。これから AI が読みます。" : "保存しました。");
      await load();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const field = (key: keyof typeof form, label: string, rows: number, hint?: string) => (
    <label style={{ display: "block", marginBottom: 8 }}>
      {label}{hint && <small style={{ color: "#777" }}>（{hint}）</small>}
      <textarea value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} rows={rows} style={{ width: "100%" }} />
    </label>
  );

  return (
    <>
      <h2>議事録：{m.held_on} {m.kind}</h2>
      <p style={{ margin: "0 0 8px" }}>
        相手 <button style={link} onClick={() => setView({ name: "buyer", id: m.buyer_id })}>{m.buyer_name}</button>
        <span style={{ marginLeft: 8, color: m.status === "draft" ? "#b06000" : "#137333" }}>{m.status === "draft" ? "下書き（AI はまだ読みません）" : "確定"}</span>
      </p>
      {field("participants", "参加者", 1)}
      {field("summary", "要約", 3)}
      {field("decisions", "決定事項", 3, "1行に1件")}
      {field("openIssues", "残った論点", 3, "1行に1件")}
      {field("promises", "次回の約束", 3, "1行に1件。期日は「｜」のあとに")}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => save(false)}>保存</button>
        {m.status === "draft" && <button onClick={() => save(true)}>確定する</button>}
      </div>
      {saved && <p style={{ color: "#137333" }}>{saved}</p>}
      {m.priorities.some((p) => p.status === "pending") && (
        <p style={{ fontSize: 14 }}>
          この商談から「今大事にしていること」の候補が出ています。
          <button style={link} onClick={() => setView({ name: "buyer", id: m.buyer_id })}>担当バイヤーのページで承認する</button>
        </p>
      )}
    </>
  );
}

function NewMeeting({ buyerId, setView, onError }: Nav & { buyerId: string }) {
  const [form, setForm] = useState({ heldOn: new Date().toISOString().slice(0, 10), kind: "商談", participants: "", summary: "", decisions: "", openIssues: "" });
  const submit = async () => {
    try {
      const r = await call<{ id: string }>("/api/meetings", "POST", {
        buyerId, heldOn: form.heldOn, kind: form.kind, participants: form.participants, summary: form.summary,
        decisions: lines(form.decisions), openIssues: lines(form.openIssues),
      });
      setView({ name: "meeting", id: r.id });
    } catch (e) {
      onError((e as Error).message);
    }
  };
  return (
    <>
      <h2>議事録を書く</h2>
      <p style={{ color: "#555" }}>録音が無い商談は、ここから手で残します。保存すると下書きになり、確定すると AI が読みます。</p>
      <label style={{ display: "block", marginBottom: 8 }}>日付 <input type="date" value={form.heldOn} onChange={(e) => setForm({ ...form, heldOn: e.target.value })} /></label>
      <label style={{ display: "block", marginBottom: 8 }}>種類 <input value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} /></label>
      {(
        [["participants", "参加者", 1], ["summary", "要約", 3], ["decisions", "決定事項（1行に1件）", 3], ["openIssues", "残った論点（1行に1件）", 3]] as const
      ).map(([k, label, rows]) => (
        <label key={k} style={{ display: "block", marginBottom: 8 }}>
          {label}
          <textarea value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} rows={rows} style={{ width: "100%" }} />
        </label>
      ))}
      <button onClick={submit} disabled={!form.summary.trim()}>保存</button>
    </>
  );
}
