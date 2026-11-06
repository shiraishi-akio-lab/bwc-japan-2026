import { useCallback, useEffect, useState } from "react";
import { box, call } from "./Accounts";
import { useMe } from "./me";

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

const small = { fontSize: 14, color: "#555" } as const;

// 出どころと日付はいつも一緒に見せる
function Source({ i }: { i: Interest }) {
  return (
    <div style={small}>
      {i.published_on ? `掲載 ${i.published_on}` : "掲載日は読み取れず"}　取得 {i.fetched_on}　
      <a href={i.source_url} target="_blank" rel="noreferrer">{i.source_title}</a>
      <br />根拠：{i.basis}
    </div>
  );
}

// 取引先の画面：公開情報を読み、候補を人が承認する。未承認は AI にも準備室にも渡らない
export function InterestsPanel({ accountId, siteUrl, onError }: { accountId: string; siteUrl: string; onError: OnError }) {
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
      <h3>この会社の関心</h3>
      <p style={small}>ニュースリリース・決算情報・新しい取り組みのページを読み、関心の候補を出します。上司が承認したものだけを、準備室と AI が読みます。</p>
      {isManager && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="読む会社のURL" style={{ flex: "1 1 240px", minWidth: 0 }} />
        <button onClick={start} disabled={busy || !url.trim()}>公開情報から読む</button>
      </div>}
      {busy && <p style={small}>読んでいます…</p>}
      {read && <p style={small}>{read.pages.length}ページを読み、候補を{read.added}件足しました。{read.added === 0 && "（読んだことのあるページは読み直しません）"}</p>}
      {approved.map((i) => (
        <div key={i.id} style={box}>
          <strong>{i.text}</strong>
          <Source i={i} />
        </div>
      ))}
      {pending.length > 0 && <h4>候補（承認すると AI が読みます）</h4>}
      {pending.map((i) => (
        <div key={i.id} style={{ ...box, borderColor: "#f0c36d" }}>
          {i.text}
          <Source i={i} />
          <button onClick={() => judge(i.id, "approved")}>承認</button>{" "}
          <button onClick={() => judge(i.id, "rejected")}>見送り</button>
        </div>
      ))}
    </>
  );
}

const ObservationItem = ({ o }: { o: Observation }) => (
  <div style={box}>
    {o.tendency}
    <div style={small}>{o.held_on}　根拠の発言：{o.basis}</div>
    <div style={small}>キーワード：{o.keywords.join("・")}</div>
  </div>
);

// 担当バイヤーの画面：読むだけ。確定した商談で観察されたことだけが出る
export function ObservationsPanel({ buyerId, onError }: { buyerId: string; onError: OnError }) {
  const [rows, setRows] = useState<Observation[]>([]);
  useEffect(() => {
    call<Observation[]>(`/api/buyers/${buyerId}/observations`).then(setRows).catch((e: Error) => onError(e.message));
  }, [buyerId, onError]);
  return (
    <>
      <h3>商談で観察された傾向</h3>
      {rows.length === 0 && <p style={{ color: "#777" }}>まだ記録はありません。</p>}
      {rows.map((o) => <ObservationItem key={o.id} o={o} />)}
    </>
  );
}

const cell = { padding: "4px 8px", borderBottom: "1px solid #ddd", textAlign: "left", verticalAlign: "top" } as const;

// ことカレンダー：読むだけ
export function SeasonCalendar({ onError }: { onError: OnError }) {
  const [rows, setRows] = useState<SeasonEvent[]>([]);
  useEffect(() => {
    call<SeasonEvent[]>("/api/season-events").then(setRows).catch((e: Error) => onError(e.message));
  }, [onError]);
  return (
    <details style={{ margin: "16px 0" }}>
      <summary>ことカレンダー（1年分）</summary>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640, fontSize: 14 }}>
          <thead>
            <tr>{["行事・投入時期", "締切の目安", "店の動き", "提案内容", "自社の過去の実績"].map((h) => <th key={h} style={cell}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td style={cell}>{e.name}（{e.month}/{e.day}ごろ）</td>
                <td style={cell}>{e.deadline_month}/{e.deadline_day}</td>
                <td style={cell}>{e.store_action}</td>
                <td style={cell}>{e.proposal}</td>
                <td style={cell}>{e.own_result}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// 準備室の1枚。当てはまるものだけをサーバーが絞って返す。written が変わると絞り直す
export function PrepBrief({ prepId, written, onError }: { prepId: string; written: string; onError: OnError }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  useEffect(() => {
    call<Brief>(`/api/preps/${prepId}/brief`).then(setBrief).catch((e: Error) => onError(e.message));
  }, [prepId, written, onError]);
  if (!brief) return null;
  return (
    <>
      <h2>相手と時期の下調べ</h2>
      <h3>相手の関心（公開情報から、人が承認したもの）</h3>
      {brief.interests.length === 0 && <p style={{ color: "#777" }}>承認された関心はまだありません。上司が公開情報を読んで承認すると、ここに出ます。</p>}
      {brief.interests.map((i) => (
        <div key={i.id} style={box}>
          <strong>{i.text}</strong>
          <Source i={i} />
        </div>
      ))}
      {brief.observations.length > 0 && <h3>商談で観察された傾向</h3>}
      {brief.observations.map((o) => <ObservationItem key={o.id} o={o} />)}
      {brief.events.length > 0 && <h3>この商談から間に合う行事</h3>}
      {brief.events.map((e) => (
        <div key={e.id} style={box}>
          <strong>{e.name}</strong>（{e.event_on}ごろ）
          <div style={small}>提案の締切の目安 {e.deadline_on}</div>
          <div style={{ fontSize: 14 }}>店の動き：{e.store_action}</div>
          <div style={{ fontSize: 14 }}>提案内容：{e.proposal}</div>
          <div style={{ fontSize: 14 }}>自社の過去の実績：{e.own_result}</div>
        </div>
      ))}
    </>
  );
}
