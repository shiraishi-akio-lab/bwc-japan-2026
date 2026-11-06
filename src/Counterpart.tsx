import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "./api";
import { Button, Card, Empty, ErrorNotice, Facts, Sub, Tag, Title, Waiting } from "./ui";
import { W } from "./words";

// 相手の棚：企業の関心・担当者の傾向・ことカレンダー
type Interest = {
  id: string; text: string; basis: string; theme: string; source_url: string; source_title: string;
  published_on: string; fetched_on: string; status: string;
};
type Observation = { id: string; tendency: string; keywords: string[]; basis: string; held_on: string };
type SeasonEvent = { id: string; name: string; month: number; day: number; deadline_month: number; deadline_day: number; store_action: string; proposal: string; own_result: string };
type DatedEvent = SeasonEvent & { event_on: string; deadline_on: string };
type PosWeek = { week_on: string; units: number; ly_units: number };
type PosSeries = { id: string; name: string; own: boolean; weeks: PosWeek[]; avg_units: number; yoy_pct: number; before_units: number; after_units: number };
type Pos = {
  title: string; fetched_on: string; revised_on: string; from_on: string; to_on: string;
  before_from: string; before_to: string; after_from: string; after_to: string; series: PosSeries[];
};
type Brief = { interests: Interest[]; observations: Observation[]; events: DatedEvent[]; pos: Pos | null };
type Partner = Brief & { promises: { text: string; due: string }[]; meetings: { held_on: string; kind: string; summary: string; decisions: string[] }[] };
type Read = { pages: { url: string; title: string; date: string }[]; added: number };
type OnError = (m: string | null) => void;

// 出どころと日付はいつも一緒に見せる
const sourceRows = (i: Interest): [string, React.ReactNode][] => [
  [W.brief.source, <a href={i.source_url} target="_blank" rel="noreferrer">{i.source_title || i.source_url}</a>],
  [W.brief.published, i.published_on || W.brief.noPublished],
  [W.brief.fetched, i.fetched_on],
  [W.brief.basis, i.basis],
];

// 取引先の画面と下調べ：公開情報は誰でも読み、読んだ人が出どころを見て確かめる。未確認は AI にも準備室にも渡らない
export function InterestsPanel({ accountId, siteUrl, onError, onChange, reading = false }: { accountId: string; siteUrl: string; onError: OnError; onChange?: () => void; reading?: boolean }) {
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
  const judge = (id: string, status: string) => call(`/api/interests/${id}`, "POST", { status }).then(load).then(() => onChange?.()).catch((e: Error) => onError(e.message));
  const approved = rows.filter((r) => r.status === "approved");
  const pending = rows.filter((r) => r.status === "pending");

  return (
    <>
      {!reading && <Title size="mid">{W.interests.title}</Title>}
      {!reading && <p className="muted">{W.interests.lead}</p>}
      {!reading && rows.length === 0 && <Empty>{W.state.noData}</Empty>}
      {pending.length > 0 && <Sub>{W.interests.candidates}</Sub>}
      {pending.map((i) => (
        <div key={i.id} className="box">
          <div className="row"><Tag kind="wait">{W.interests.unchecked}</Tag><strong>{i.text}</strong></div>
          <Facts two rows={sourceRows(i)} />
          <div className="row">
            <Button small onClick={() => judge(i.id, "approved")}>{W.interests.approve}</Button>
            <Button small ghost onClick={() => judge(i.id, "rejected")}>{W.interests.reject}</Button>
          </div>
        </div>
      ))}
      {!reading && approved.map((i) => (
        <div key={i.id} className="box">
          <div className="row"><Tag kind="ok">{W.interests.used}</Tag><strong>{i.text}</strong></div>
          <Facts two rows={sourceRows(i)} />
        </div>
      ))}
      <Title size="mid">{W.interests.readTitle}</Title>
      {reading && <p className="muted">{W.interests.readLead}</p>}
      <div className="say-input">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label={W.interests.urlLabel} />
        <Button onClick={start} disabled={busy || !url.trim()}>{W.interests.read}</Button>
      </div>
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

const monthDay = (iso: string) => `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;
const seriesName = (s: PosSeries) => s.name || W.pos.floor;

// 1本ごとに別のグラフにする（売場全体と自社品は桁が違うので、同じ目盛りに載せない）。
// 色と線の形で今年と前年を分ける。数字は下の1行と表でも読める
const CHART = { w: 240, h: 84, x: 6, top: 8, bottom: 4 };
function PosChart({ s }: { s: PosSeries }) {
  const [at, setAt] = useState(s.weeks.length - 1);
  const max = Math.max(...s.weeks.flatMap((w) => [w.units, w.ly_units])) * 1.1;
  const step = (CHART.w - CHART.x * 2) / (s.weeks.length - 1);
  const x = (i: number) => CHART.x + i * step;
  const y = (v: number) => CHART.h - CHART.bottom - (v / max) * (CHART.h - CHART.top - CHART.bottom);
  const line = (key: "units" | "ly_units") => s.weeks.map((w, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(w[key]).toFixed(1)}`).join(" ");
  const week = s.weeks[at];
  return (
    <div className="pos-panel">
      <div className="row"><strong>{seriesName(s)}</strong>{s.own && <Tag kind="step">{W.tag.own}</Tag>}</div>
      <p className="pos-stat">
        <span><small>{W.pos.avg}</small><b>{W.pos.unit(s.avg_units)}</b></span>
        <span><small>{W.pos.yoy}</small><b>{W.pos.pct(s.yoy_pct)}</b></span>
      </p>
      <svg className="pos-chart" viewBox={`0 0 ${CHART.w} ${CHART.h}`} role="img" aria-label={W.pos.chartLabel(seriesName(s), s.avg_units, s.yoy_pct)} onPointerLeave={() => setAt(s.weeks.length - 1)}>
        <line className="pos-base" x1={0} x2={CHART.w} y1={y(0)} y2={y(0)} />
        <line className="pos-cross" x1={x(at)} x2={x(at)} y1={CHART.top - 4} y2={y(0)} />
        <path className="pos-ly" d={line("ly_units")} />
        <path className="pos-now" d={line("units")} />
        <circle className="pos-dot" cx={x(at)} cy={y(week.units)} r={4} />
        {s.weeks.map((w, i) => <rect key={w.week_on} className="pos-hit" x={x(i) - step / 2} y={0} width={step} height={CHART.h} onPointerEnter={() => setAt(i)} onPointerDown={() => setAt(i)} />)}
      </svg>
      <div className="pos-ends"><small>{monthDay(s.weeks[0].week_on)}</small><small>{monthDay(s.weeks[s.weeks.length - 1].week_on)}</small></div>
      <p className="small" aria-live="polite">{W.pos.point(monthDay(week.week_on), week.units, week.ly_units)}</p>
    </div>
  );
}

// 店頭の販売実績。売場全体と自社品だけ。順に意味を持たせない（並びは品の id の順で、売れ行きの順にしない）
function PosCard({ pos }: { pos: Pos | null }) {
  if (!pos) {
    return (
      <Card>
        <div><Tag kind="soft">{W.pos.label}</Tag></div>
        <Empty>{W.pos.none}</Empty>
      </Card>
    );
  }
  const revised = `${pos.revised_on.slice(0, 4)}年${Number(pos.revised_on.slice(5, 7))}月`;
  const before = `${monthDay(pos.before_from)}〜${monthDay(pos.before_to)}`;
  const after = `${monthDay(pos.after_from)}〜${monthDay(pos.after_to)}`;
  return (
    <Card>
      <div className="row"><Tag kind="soft">{W.pos.label}</Tag><Tag kind="line">{W.pos.fictional}</Tag></div>
      <h3 className="item">{W.pos.title}</h3>
      <div className="pos-legend" aria-hidden="true">
        <span><svg viewBox="0 0 28 8"><path className="pos-now" d="M0 4H28" /></svg>{W.pos.now}</span>
        <span><svg viewBox="0 0 28 8"><path className="pos-ly" d="M0 4H28" /></svg>{W.pos.lastYear}</span>
      </div>
      <div className="pos-grid">{pos.series.map((s) => <PosChart key={s.id} s={s} />)}</div>
      <p className="small">{W.pos.scale}</p>
      <details>
        <summary>{W.pos.table}</summary>
        <div className="scroll-x">
          <table>
            <thead>
              <tr><th>{W.pos.weekCol}</th>{pos.series.flatMap((s) => [<th key={s.id} className="num">{seriesName(s)}</th>, <th key={`${s.id}-ly`} className="num">{W.pos.lastYear}</th>])}</tr>
            </thead>
            <tbody>
              {pos.series[0].weeks.map((w, i) => (
                <tr key={w.week_on}>
                  <td>{monthDay(w.week_on)}</td>
                  {pos.series.flatMap((s) => [<td key={s.id} className="num">{W.pos.unit(s.weeks[i].units)}</td>, <td key={`${s.id}-ly`} className="num">{W.pos.unit(s.weeks[i].ly_units)}</td>])}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <Sub>{W.pos.revision(revised)}</Sub>
      <div className="scroll-x">
        <table>
          <thead>
            <tr>{W.pos.revisionCols(before, after).map((h, i) => <th key={i} className={i ? "num" : undefined}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {pos.series.map((s) => (
              <tr key={s.id}>
                <td>{seriesName(s)} {s.own && <Tag kind="step">{W.tag.own}</Tag>}</td>
                <td className="num">{W.pos.unit(s.before_units)}</td>
                <td className="num">{W.pos.unit(s.after_units)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">{W.pos.revisionNote}</p>
      <Facts two rows={[[W.pos.source, pos.title], [W.pos.period, `${monthDay(pos.from_on)}〜${monthDay(pos.to_on)}`], [W.pos.fetched, pos.fetched_on]]} />
    </Card>
  );
}

// 下調べと相手の情報で同じ形を使う
function BriefCards({ brief }: { brief: Brief }) {
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
          <div className="row"><Tag kind="soft">{W.brief.interest}</Tag><Tag kind="ok">{W.interests.used}</Tag></div>
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
      <PosCard pos={brief.pos} />
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

// 準備室の1枚。当てはまるものだけをサーバーが絞って返す。written が変わると絞り直す
export function PrepBrief({ prepId, written, onError }: { prepId: string; written: string; onError: OnError }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    call<Brief>(`/api/preps/${prepId}/brief`).then(setBrief).catch((e: Error) => { setFailed(true); onError(e.message); });
  }, [prepId, written, onError]);
  if (failed) return null;
  if (!brief) return <Waiting>{W.state.reading}</Waiting>;
  return <BriefCards brief={brief} />;
}

// 相手の情報：準備室のどの段階からでも開く1枚。下の段階の画面は残したまま、上に重ねる
export function PartnerSheet({ prepId, name, onClose }: { prepId: string; name: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<Partner | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    call<Partner>(`/api/preps/${prepId}/partner`).then(setData).catch((e: Error) => setError(e.message));
  }, [prepId]);
  return (
    <dialog ref={dialog} className="info-sheet" aria-labelledby="info-sheet-title" onClose={onClose}>
      <div className="info-head">
        <div className="stack">
          <h2 id="info-sheet-title" className="title title-mid">{W.partner.title(name)}</h2>
          <p className="small">{W.partner.lead}</p>
        </div>
        <Button ghost small onClick={() => dialog.current?.close()}>{W.partner.close}</Button>
      </div>
      <div className="info-body">
        <ErrorNotice message={error} />
        {!data && !error && <Waiting>{W.state.reading}</Waiting>}
        {data && (
          <>
            <BriefCards brief={data} />
            <Card>
              <Title size="mid">{W.partner.promises}</Title>
              {data.promises.length === 0 && <Empty>{W.state.noRecord}</Empty>}
              {data.promises.map((p, i) => <p key={i}>{p.text}{p.due && W.partner.due(p.due)}</p>)}
            </Card>
            <Card>
              <div className="row"><Title size="mid">{W.partner.meetings}</Title><Tag kind="line">{W.tag.fromConfirmed}</Tag></div>
              {data.meetings.length === 0 && <Empty>{W.state.noRecord}</Empty>}
              {data.meetings.map((m, i) => (
                <div key={i} className="box">
                  <p className="muted">{m.held_on} {m.kind}</p>
                  <p>{m.summary}</p>
                  {m.decisions.length > 0 && <Facts rows={[[W.partner.decisions, m.decisions.join("／")]]} />}
                </div>
              ))}
            </Card>
          </>
        )}
      </div>
    </dialog>
  );
}
