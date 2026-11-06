import { useCallback, useEffect, useState } from "react";
import { call } from "./api";
import { InterestsPanel, ObservationsPanel, SeasonCalendar } from "./Counterpart";
import { HandoffPage, HandoffStart } from "./Handoff";
import { useMe } from "./me";
import { Approved, Button, Card, Empty, ErrorNotice, Facts, LinkButton, Pending, Saved, Sub, Tag, Title, Why } from "./ui";
import { W } from "./words";

type AccountRow = { id: string; name: string; format: string; stores: number; owner_rep: string; buyer_count: number; last_met: string | null };
type Account = { id: string; name: string; format: string; stores: number; profile: string; rules: string; owner_rep: string; site_url: string };
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

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

export function Accounts({ view, setView, onPractice }: { view: View; setView: (v: View) => void; onPractice: (buyerId: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <ErrorNotice message={error} />
      {view.name !== "list" && <div><LinkButton onClick={() => setView({ name: "list" })}>{W.accounts.back}</LinkButton></div>}
      {view.name === "list" && <List setView={setView} onError={setError} />}
      {view.name === "account" && <AccountPage id={view.id} setView={setView} onError={setError} />}
      {view.name === "buyer" && <BuyerPage id={view.id} setView={setView} onError={setError} onPractice={onPractice} />}
      {view.name === "meeting" && <MeetingPage id={view.id} setView={setView} onError={setError} />}
      {view.name === "newMeeting" && <NewMeeting buyerId={view.buyerId} setView={setView} onError={setError} />}
      {view.name === "handoff" && <HandoffPage id={view.id} setView={setView} onError={setError} onPractice={onPractice} />}
    </>
  );
}

type Nav = { setView: (v: View) => void; onError: (m: string | null) => void };

function List({ setView, onError }: Nav) {
  const [rows, setRows] = useState<AccountRow[]>([]);
  useEffect(() => {
    call<AccountRow[]>("/api/accounts").then(setRows).catch((e: Error) => onError(e.message));
  }, [onError]);
  return (
    <Card>
      <Title size="big" as="h1">{W.accounts.list}</Title>
      <p className="lead">{W.accounts.lead}</p>
      <div className="grid-3">
        {rows.map((a) => (
          <button key={a.id} type="button" className="pick" onClick={() => setView({ name: "account", id: a.id })}>
            <span className="pick-name">{a.name}</span>
            <span className="small">{a.format}・{a.stores}店舗</span>
            <span className="small">{W.accounts.ownerRep} {a.owner_rep}／{W.accounts.lastMet} {a.last_met ?? W.accounts.none}</span>
          </button>
        ))}
      </div>
    </Card>
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
      <Card>
        <Title size="big" as="h1">{account.name}</Title>
        <p className="muted">{account.format}・{account.stores}店舗／{W.accounts.ownerRep} {account.owner_rep}</p>
        <p>{account.profile}</p>
        <p className="muted">{W.accounts.rules}：{account.rules}</p>
      </Card>
      <Card><InterestsPanel accountId={account.id} siteUrl={account.site_url} onError={onError} /></Card>
      <Card>
        <Title size="mid">{W.accounts.buyers}</Title>
        <div className="grid-3">
          {buyers.map((b) => (
            <button key={b.id} type="button" className="pick" onClick={() => setView({ name: "buyer", id: b.id })}>
              <span className="pick-name">{b.name}</span>
              <span className="small">{b.role}</span>
              <Tag kind={b.status === "現役" ? "soft" : "wait"}>{b.status}</Tag>
            </button>
          ))}
        </div>
      </Card>
      <Card>
        <Title size="mid">{W.accounts.meetings}</Title>
        <MeetingList meetings={meetings} setView={setView} />
      </Card>
      <SeasonCalendar onError={onError} />
      <Card><HandoffStart accountId={account.id} ownerRep={account.owner_rep} setView={setView} onError={onError} /></Card>
    </>
  );
}

function MeetingList({ meetings, setView }: { meetings: Meeting[]; setView: (v: View) => void }) {
  if (meetings.length === 0) return <Empty>{W.state.noData}</Empty>;
  return (
    <div className="stack">
      {meetings.map((m) => (
        <button key={m.id} type="button" className="pick" onClick={() => setView({ name: "meeting", id: m.id })}>
          <span className="row">
            <strong>{m.held_on} {m.kind}（{m.buyer_name}）</strong>
            <Tag kind={m.status === "draft" ? "wait" : "line"}>{m.status === "draft" ? W.tag.draft : W.tag.confirmed}</Tag>
          </span>
          <span>{m.summary}</span>
        </button>
      ))}
    </div>
  );
}

function BuyerPage({ id, setView, onError, onPractice }: Nav & { id: string; onPractice: (buyerId: string) => void }) {
  const isManager = useMe().role === "manager";
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
      <Card>
        <div className="row">
          <Title size="big" as="h1">{buyer.name}</Title>
          <Tag kind={buyer.status === "現役" ? "soft" : "wait"}>{buyer.status}</Tag>
        </div>
        <p className="muted">{account.name}　{buyer.role}</p>
        <div className="row">
          {buyer.status === "現役" && !isManager && <Button onClick={() => onPractice(buyer.id)}>{W.accounts.practice}</Button>}
          <Button ghost onClick={() => setView({ name: "newMeeting", buyerId: buyer.id })}>{W.accounts.writeMinutes}</Button>
          <Button ghost onClick={() => setView({ name: "account", id: account.id })}>{W.accounts.backAccount}</Button>
        </div>
      </Card>

      <Card>
        <Title size="mid">{W.accounts.priorities}</Title>
        {approved.length === 0 && <Empty>{W.state.noData}</Empty>}
        {approved.map((p) => (
          <div key={p.id} className="box">
            <div className="row"><Approved /><strong>{p.text}</strong></div>
            <small>{p.noted_on}　{W.accounts.basis}：{p.basis}</small>
          </div>
        ))}
        {pending.length > 0 && <Sub>{W.accounts.candidates}</Sub>}
        {pending.map((p) => (
          <div key={p.id} className="box">
            <div className="row"><Pending /><strong>{p.text}</strong></div>
            <small>{p.noted_on}　{W.accounts.basis}：{p.basis}</small>
            {isManager && (
              <div className="row">
                <Button small onClick={() => judge(p.id, "approved")}>{W.accounts.approve}</Button>
                <Button small ghost onClick={() => judge(p.id, "rejected")}>{W.accounts.reject}</Button>
              </div>
            )}
          </div>
        ))}
      </Card>

      <ObservationsPanel buyerId={buyer.id} onError={onError} />

      <Card>
        <Title size="mid">{W.accounts.promises}</Title>
        {promises.length === 0 && <Empty>{W.accounts.noPromises}</Empty>}
        {promises.map((p) => (
          <label key={p.id} className="check">
            <input type="checkbox" checked={!!p.done} onChange={() => toggle(p)} />
            <span>
              {p.text}{p.due && `（${p.due}まで）`}
              {p.meeting_status === "draft" && <small>{W.accounts.meetingDraftNote}</small>}
            </span>
          </label>
        ))}
      </Card>

      <Card>
        <Title size="mid">{W.accounts.minutes}</Title>
        <MeetingList meetings={meetings} setView={setView} />
      </Card>
    </>
  );
}

function MeetingPage({ id, setView, onError }: Nav & { id: string }) {
  const isManager = useMe().role === "manager";
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
      setSaved(confirm ? W.meeting.confirmedDone : W.meeting.savedDone);
      await load();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const field = (key: keyof typeof form, label: string, rows: number, hint?: string) => (
    <label className="field">
      <span>{label}{hint && <small>（{hint}）</small>}</span>
      <textarea value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} rows={rows} />
    </label>
  );

  return (
    <Card>
      <Title size="big" as="h1">{W.meeting.title(m.held_on, m.kind)}</Title>
      <div className="row">
        <span>{W.meeting.partner} <LinkButton onClick={() => setView({ name: "buyer", id: m.buyer_id })}>{m.buyer_name}</LinkButton></span>
        {m.status === "draft"
          ? <><Tag kind="wait">{W.tag.draft}</Tag><small>{W.meeting.draft}</small></>
          : <Tag kind="line">{W.tag.confirmed}</Tag>}
      </div>
      {field("participants", W.meeting.participants, 1)}
      {field("summary", W.meeting.summary, 3)}
      {field("decisions", W.meeting.decisions, 3, W.meeting.perLine)}
      {field("openIssues", W.meeting.openIssues, 3, W.meeting.perLine)}
      {field("promises", W.meeting.promises, 3, W.meeting.promiseHint)}
      <div className="row">
        {(isManager || m.status === "draft") && <Button ghost={m.status === "draft" && isManager} onClick={() => save(false)}>{W.meeting.save}</Button>}
        {m.status === "draft" && isManager && <Button onClick={() => save(true)}>{W.meeting.confirm}</Button>}
      </div>
      {saved && <Saved>{saved}</Saved>}
      {m.priorities.some((p) => p.status === "pending") && (
        <p className="small">
          {W.meeting.candidateNote} <LinkButton onClick={() => setView({ name: "buyer", id: m.buyer_id })}>{W.meeting.openBuyer}</LinkButton>
        </p>
      )}
    </Card>
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
  const areas = [
    ["participants", W.meeting.participants, 1],
    ["summary", W.meeting.summary, 3],
    ["decisions", `${W.meeting.decisions}（${W.meeting.perLine}）`, 3],
    ["openIssues", `${W.meeting.openIssues}（${W.meeting.perLine}）`, 3],
  ] as const;
  return (
    <Card>
      <Title size="big" as="h1">{W.meeting.newTitle}</Title>
      <p className="lead">{W.meeting.newLead}</p>
      <div className="row-end">
        <label className="field">{W.meeting.date}<input type="date" value={form.heldOn} onChange={(e) => setForm({ ...form, heldOn: e.target.value })} /></label>
        <label className="field">{W.meeting.kind}<input value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} /></label>
      </div>
      {areas.map(([k, label, rows]) => (
        <label key={k} className="field">
          {label}
          <textarea value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} rows={rows} />
        </label>
      ))}
      <div className="row">
        <Button onClick={submit} disabled={!form.summary.trim()}>{W.meeting.save}</Button>
        {!form.summary.trim() && <Why>{W.meeting.summaryWhy}</Why>}
      </div>
    </Card>
  );
}

