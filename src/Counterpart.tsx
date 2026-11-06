import { useCallback, useEffect, useState } from "react";
import { call } from "./api";
import { useMe } from "./me";
import { Approved, Button, Card, Empty, Facts, Pending, Sub, Tag, Title, Waiting } from "./ui";
import { W } from "./words";

// 相手の棚：企業の関心・担当者の傾向・ことカレンダー
type Interest = {
  id: string; text: string; basis: string; theme: string; source_url: string; source_title: string;
  published_on: string; fetched_on: string; status: string;
};
type Observation = { id: string; tendency: string; keywords: string[]; basis: string; held_on: string };
type SeasonEvent = { id: string; name: string; month: number; day: number; deadline_month: number; deadline_day: number; store_action: string; proposal: string; own_result: string };
type DatedEvent = SeasonEvent & { event_on: string; deadline_on: string };
type Brief = { interests: Interest[]; observations: Observation[]; events: DatedEvent[] };
type Read = { pages: { url: string; title: string; date: string }[]; added: number };
type OnError = (m: string | null) => void;

// 出どころと日付はいつも一緒に見せる
const sourceRows = (i: Interest): [string, React.ReactNode][] => [
  [W.brief.source, <a href={i.source_url} target="_blank" rel="noreferrer">{i.source_title || i.source_url}</a>],
  [W.brief.published, i.published_on || W.brief.noPublished],
  [W.brief.fetched, i.fetched_on],
  [W.brief.basis, i.basis],
];

// 取引先の画面と候補の承認：公開情報を読み、候補を人が承認する。未承認は AI にも準備室にも渡らない
export function InterestsPanel({ accountId, siteUrl, onError, title = W.interests.title, lead = W.interests.lead, empty = W.state.noData }: { accountId: string; siteUrl: string; onError: OnError; title?: string; lead?: string; empty?: string }) {
  const isManager = useMe().role === "manager";
  const [rows, setRows] = useState<Interest[]>([]);
  const [url, setUrl] = useState(siteUrl);
  const [busy, setBusy] = useState(false);
  const [read, setRead] = useState<Read | null>(null);
  const load = useCallback(
    () => call<Interest[]>(`/api/accounts/${accountId}/interests`).then(setRows).catch((e: Error) => onError(e.message)),
    [accountId, onError],
  );
  useEffect(() => { void load(); }, [load]);

  const start = async () => {
    setBusy(true);
    onError(null);
    try {
      setRead(await call<Read>(`/api/accounts/${accountId}/read-site`, "POST", { url }));
      await load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const judge = (id: string, status: string) => call(`/api/interests/${id}`, "POST", { status }).then(load).catch((e: Error) => onError(e.message));
  const approved = rows.filter((r) => r.status === "approved");
  const pending = rows.filter((r) => r.status === "pending");

  return (
    <>
      <Title size="mid">{title}</Title>
      {lead && <p className="muted">{lead}</p>}
      {rows.length === 0 && <Empty>{empty}</Empty>}
      {pending.length > 0 && <Sub>{W.interests.candidates}</Sub>}
      {pending.map((i) => (
        <div key={i.id} className="box">
          <div className="row"><Pending /><strong>{i.text}</strong></div>
          <Facts two rows={sourceRows(i)} />
          <div className="row">
            <Button small onClick={() => judge(i.id, "approved")}>{W.interests.approve}</Button>
            <Button small ghost onClick={() => judge(i.id, "rejected")}>{W.interests.reject}</Button>
          </div>
        </div>
      ))}
      {approved.map((i) => (
        <div key={i.id} className="box">
          <div className="row"><Approved /><strong>{i.text}</strong></div>
          <Facts two rows={sourceRows(i)} />
        </div>
      ))}
      {isManager && (
        <>
          <Title size="mid">{W.interests.readTitle}</Title>
          <div className="say-input">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label={W.interests.urlLabel} />
            <Button onClick={start} disabled={busy || !url.trim()}>{W.interests.read}</Button>
          </div>
        </>
      )}
      {busy && <Waiting>{W.state.reading}</Waiting>}
      {read && <p className="small" role="status">{W.interests.done(read.pages.length, read.added)}</p>}
    </>
  );
}

// 担当バイヤーの画面：読むだけ。確定した商談で観察されたことだけが出る
export function ObservationsPanel({ buyerId, onError }: { buyerId: string; onError: OnError }) {
  const [rows, setRows] = useState<Observation[]>([]);
  useEffect(() => {
    call<Observation[]>(`/api/buyers/${buyerId}/observations`).then(setRows).catch((e: Error) => onError(e.message));
  }, [buyerId, onError]);
  return (
    <Card>
      <Title size="mid">{W.brief.tendency}</Title>
      {rows.length === 0 && <Empty>{W.state.noData}</Empty>}
      {rows.map((o) => (
        <div key={o.id} className="box">
          <strong>{o.tendency}</strong>
          <Facts rows={[[W.brief.date, o.held_on], [W.brief.keyword, o.keywords.join("・")], [W.brief.saidBasis, o.basis]]} />
        </div>
      ))}
    </Card>
  );
}

// ことカレンダー：読むだけ
export function SeasonCalendar({ onError }: { onError: OnError }) {
  const [rows, setRows] = useState<SeasonEvent[]>([]);
  useEffect(() => {
    call<SeasonEvent[]>("/api/season-events").then(setRows).catch((e: Error) => onError(e.message));
  }, [onError]);
  return (
    <Card>
      <details>
        <summary>{W.accounts.calendar}</summary>
        <div className="scroll-x">
          <table style={{ minWidth: 640 }}>
            <thead>
              <tr>{W.accounts.calendarCols.map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}（{e.month}/{e.day}ごろ）</td>
                  <td>{e.deadline_month}/{e.deadline_day}</td>
                  <td>{e.store_action}</td>
                  <td>{e.proposal}</td>
                  <td>{e.own_result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}

// 準備室の1枚。当てはまるものだけをサーバーが絞って返す。written が変わると絞り直す
export function PrepBrief({ prepId, written, onError }: { prepId: string; written: string; onError: OnError }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    call<Brief>(`/api/preps/${prepId}/brief`).then(setBrief).catch((e: Error) => { setFailed(true); onError(e.message); });
  }, [prepId, written, onError]);
  if (failed) return null;
  if (!brief) return <Waiting>{W.state.reading}</Waiting>;
  return (
    <>
      {brief.interests.length === 0 && (
        <Card>
          <div><Tag kind="soft">{W.brief.interest}</Tag></div>
          <Empty>{W.brief.noInterest}</Empty>
        </Card>
      )}
      {brief.interests.map((i) => (
        <Card key={i.id}>
          <div className="row"><Tag kind="soft">{W.brief.interest}</Tag><Approved /></div>
          <h3 className="item">{i.text}</h3>
          <Facts two rows={sourceRows(i)} />
        </Card>
      ))}
      {brief.observations.map((o) => (
        <Card key={o.id}>
          <div className="row"><Tag kind="soft">{W.brief.tendency}</Tag><Tag kind="line">{W.tag.fromConfirmed}</Tag></div>
          <h3 className="item">「{o.tendency}」</h3>
          <Facts rows={[[W.brief.keyword, o.keywords.join("・")], [W.brief.date, o.held_on], [W.brief.saidBasis, o.basis]]} />
        </Card>
      ))}
      {brief.events.map((e) => (
        <Card key={e.id}>
          <div><Tag kind="soft">{W.brief.event}</Tag></div>
          <h3 className="item">{e.name}</h3>
          <Facts rows={[
            [W.brief.eventOn, e.event_on], [W.brief.store, e.store_action], [W.brief.ownResult, e.own_result],
            [W.brief.deadline, e.deadline_on], [W.brief.proposal, e.proposal],
          ]} />
        </Card>
      ))}
    </>
  );
}
