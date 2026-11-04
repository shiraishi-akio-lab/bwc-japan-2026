import { useCallback, useEffect, useState } from "react";
import { box, call, link } from "./Accounts";

type Turn = { role: "rep" | "buyer"; content: string };
type BuyerOption = { id: string; name: string; role: string; account_name: string };
type PrepRow = { id: string; meeting_on: string; stage: string; buyer_name: string; account_name: string };
type Candidate = { id: string; name: string; maker: string; is_own: number; facings: number; weekly_units: number; yoy_pct: number };
type Card = {
  id: string; title: string; situation: string; hypothesis: string; evidence: string; proposal: string; constraints: string;
  result: string; nextJudgment: string; rejectedOptions: { option: string; reason: string }[]; author: string;
};
type Recap = {
  meeting: { held_on: string; kind: string; summary: string } | null;
  promises: { text: string; due: string }[];
  results: { initiative: string; result: string; outcome: string; held_on: string }[];
  askCause: boolean;
};
type Consult = { gainAnswer: string; returns: string[]; landing: string; summary: string; concessions: string[]; asks: string[] };
type Prep = {
  consult: Consult | null;
  id: string; sessionId: string; buyerId: string; buyerName: string; accountName: string; meetingOn: string;
  gainAnswer: string; causeHypothesis: string; returns: string[]; landing: string; stage: string; turns: Turn[];
};

const prepIdFromHash = () => window.location.hash.match(/^#prep=(.+)$/)?.[1] ?? null;

// 商談前の準備室。再読み込みしても続きから開けるよう、準備の id を URL に持つ
export function PrepRoom({ onReview }: { onReview: (sessionId: string, turns: Turn[], buyerName: string) => void }) {
  const [prep, setPrep] = useState<Prep | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback((p: Prep) => {
    window.location.hash = `prep=${p.id}`;
    setPrep(p);
  }, []);

  useEffect(() => {
    const id = prepIdFromHash();
    if (id) call<Prep>(`/api/preps/${id}`).then(setPrep).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <section>
      {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}
      {!prep && <Entrance onOpen={open} onError={setError} />}
      {prep && (
        <>
          <p style={{ margin: "0 0 4px" }}>
            <strong>{prep.accountName}　{prep.buyerName}</strong>　次の商談 {prep.meetingOn}
          </p>
          <button style={link} onClick={() => { window.location.hash = ""; setPrep(null); }}>← 別の準備を開く</button>
          <Recap prep={prep} onChange={setPrep} onError={setError} />
          <Gain prep={prep} onChange={setPrep} onError={setError} />
          {prep.gainAnswer && <Practice prep={prep} onChange={setPrep} onError={setError} />}
          {prep.gainAnswer && prep.stage !== "opening" && <Judgment key={prep.id} prep={prep} onChange={setPrep} onError={setError} />}
          {prep.returns.length >= 2 && prep.landing && <ConsultSheet prep={prep} onChange={setPrep} onError={setError} />}
          {prep.turns.some((t) => t.role === "rep") && (
            <p style={{ marginTop: 24 }}>
              <button style={link} onClick={() => onReview(prep.sessionId, prep.turns, prep.buyerName)}>この練習を3分メモで振り返る</button>
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Entrance({ onOpen, onError }: { onOpen: (p: Prep) => void; onError: (m: string | null) => void }) {
  const [buyers, setBuyers] = useState<BuyerOption[]>([]);
  const [recent, setRecent] = useState<PrepRow[]>([]);
  const [buyerId, setBuyerId] = useState("");
  const [meetingOn, setMeetingOn] = useState("");

  useEffect(() => {
    call<BuyerOption[]>("/api/preps/buyers").then((b) => { setBuyers(b); setBuyerId(b[0]?.id ?? ""); }).catch((e: Error) => onError(e.message));
    call<PrepRow[]>("/api/preps").then(setRecent).catch((e: Error) => onError(e.message));
  }, [onError]);

  const start = () => call<Prep>("/api/preps", "POST", { buyerId, meetingOn }).then(onOpen).catch((e: Error) => onError(e.message));

  return (
    <>
      <h2>次の商談の準備</h2>
      <p>ミズナギ飲料の森川として、取引先に3月の棚割りを提案する商談の、数日前に準備します。</p>
      <label style={{ display: "block", marginBottom: 8 }}>
        相手{" "}
        <select value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
          {buyers.map((b) => <option key={b.id} value={b.id}>{b.account_name}　{b.name}</option>)}
        </select>
      </label>
      <label style={{ display: "block", marginBottom: 8 }}>
        次の商談日 <input type="date" value={meetingOn} onChange={(e) => setMeetingOn(e.target.value)} />
      </label>
      <button onClick={start} disabled={!buyerId || !meetingOn}>準備を始める</button>
      {recent.length > 0 && <h3>続きから開く</h3>}
      {recent.map((r) => (
        <div key={r.id} style={box}>
          <button style={link} onClick={() => call<Prep>(`/api/preps/${r.id}`).then(onOpen).catch((e: Error) => onError(e.message))}>
            {r.account_name}　{r.buyer_name}　次の商談 {r.meeting_on}
          </button>
        </div>
      ))}
    </>
  );
}

type Step = { prep: Prep; onChange: (p: Prep) => void; onError: (m: string | null) => void };

// 前回の続き：人が確定した記録だけを読む
function Recap({ prep, onChange, onError }: Step) {
  const [data, setData] = useState<Recap | null>(null);
  const [cause, setCause] = useState(prep.causeHypothesis);
  useEffect(() => {
    call<Recap>(`/api/preps/${prep.id}/recap`).then(setData).catch((e: Error) => onError(e.message));
  }, [prep.id, onError]);
  if (!data) return null;
  const save = () => call<Prep>(`/api/preps/${prep.id}`, "PATCH", { causeHypothesis: cause }).then(onChange).catch((e: Error) => onError(e.message));
  return (
    <>
      <h2>前回の続き</h2>
      {data.meeting ? <p>{data.meeting.held_on} {data.meeting.kind}：{data.meeting.summary}</p> : <p style={{ color: "#777" }}>確定した記録はまだありません。</p>}
      {data.promises.length > 0 && <h3>前回の約束</h3>}
      {data.promises.map((p, i) => <p key={i} style={{ margin: "4px 0" }}>{p.text}{p.due && `（${p.due}まで）`}</p>)}
      {data.results.length > 0 && <h3>やった施策の結果</h3>}
      {data.results.map((r, i) => (
        <div key={i} style={{ ...box, borderColor: r.outcome === "bad" ? "#d93025" : "#ddd" }}>
          <strong>{r.initiative}</strong>
          <div>{r.result}</div>
        </div>
      ))}
      {data.askCause && (
        <>
          <label style={{ display: "block", marginBottom: 8 }}>
            結果が良くありません。原因の仮説は？
            <textarea value={cause} onChange={(e) => setCause(e.target.value)} rows={2} style={{ width: "100%" }} />
          </label>
          <button onClick={save} disabled={!cause.trim() || cause.trim() === prep.causeHypothesis}>書き留める</button>
        </>
      )}
    </>
  );
}

// 得意先の得：Claude は使わない固定の問い
function Gain({ prep, onChange, onError }: Step) {
  const [answer, setAnswer] = useState(prep.gainAnswer);
  const save = () => call<Prep>(`/api/preps/${prep.id}`, "PATCH", { gainAnswer: answer }).then(onChange).catch((e: Error) => onError(e.message));
  return (
    <>
      <h2>得意先の得</h2>
      <label style={{ display: "block", marginBottom: 8 }}>
        この提案で、相手の得は何ですか。自分の言葉で書いてください。
        <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} style={{ width: "100%" }} />
      </label>
      <button onClick={save} disabled={!answer.trim() || answer.trim() === prep.gainAnswer}>書き留める</button>
    </>
  );
}

const STAGE_NOTE: Record<string, string> = {
  agreed: "合意点に届きました。",
  ended: "この回は終わりです。返しを練り直して、答え直してください。",
};

function Practice({ prep, onChange, onError }: Step) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const closed = prep.stage === "agreed" || prep.stage === "ended";
  const send = async () => {
    setBusy(true);
    onError(null);
    try {
      const r = await call<{ prep: Prep }>(`/api/preps/${prep.id}/turn`, "POST", { text: draft });
      onChange(r.prep);
      setDraft("");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h2 id="practice">止まる練習</h2>
      <p style={{ color: "#555" }}>3月の棚割りの提案を、{prep.buyerName}に話してみてください。</p>
      <ol style={{ listStyle: "none", padding: 0 }}>
        {prep.turns.map((t, i) => (
          <li key={i} style={{ margin: "8px 0", textAlign: t.role === "rep" ? "right" : "left" }}>
            <span style={{ fontSize: 12, color: "#777" }}>{t.role === "rep" ? "あなた" : `${prep.buyerName}（バイヤー役）`}</span>
            <div style={{ display: "inline-block", padding: "8px 12px", borderRadius: 8, background: t.role === "rep" ? "#e8f0fe" : "#f1f3f4", maxWidth: "85%", textAlign: "left" }}>
              {t.content}
            </div>
          </li>
        ))}
      </ol>
      {STAGE_NOTE[prep.stage] && <p style={{ fontWeight: 600 }}>{STAGE_NOTE[prep.stage]}</p>}
      {!closed && (
        <>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} style={{ width: "100%" }} placeholder="あなたの発言" />
          <button onClick={send} disabled={busy || !draft.trim()}>話す</button>
          {busy && <span style={{ marginLeft: 8 }}>考えています…</span>}
        </>
      )}
    </>
  );
}

const CARD_SECTIONS = [
  ["situation", "状況"], ["hypothesis", "仮説"], ["evidence", "根拠"], ["proposal", "提案"],
  ["constraints", "制約"], ["result", "結果"], ["nextJudgment", "次の判断"],
] as const;

const cell = { padding: "4px 8px", borderBottom: "1px solid #ddd", textAlign: "left" } as const;

// ベテランの判断：若手が問いを受けて答えた後に見る。出すかどうかはサーバーが決める
function Judgment({ prep, onChange, onError }: Step) {
  const [data, setData] = useState<{ candidates: Candidate[]; card: Card | null } | null>(null);
  const show = useCallback(
    () => call<{ candidates: Candidate[]; card: Card | null }>(`/api/preps/${prep.id}/judgment`).then(setData).catch((e: Error) => onError(e.message)),
    [prep.id, onError],
  );
  const preparing = prep.stage !== "asked";
  useEffect(() => { if (preparing) void show(); }, [preparing, show]);

  if (!data) return <p><button onClick={show}>ベテランの判断を見る</button></p>;
  return (
    <>
      <h2>ベテランの判断</h2>
      <h3>棚の候補（週販の低い順）</h3>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
          <thead>
            <tr>{["品名", "メーカー", "列数", "週販（1店）", "前年比"].map((h) => <th key={h} style={cell}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {data.candidates.map((c) => (
              <tr key={c.id} style={c.is_own ? { background: "#fff7e0" } : undefined}>
                <td style={cell}>{c.name}{c.is_own ? "【自社品】" : ""}</td>
                <td style={cell}>{c.maker}</td>
                <td style={cell}>{c.facings}</td>
                <td style={cell}>{c.weekly_units}本</td>
                <td style={cell}>{c.yoy_pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.card ? (
        <div style={box}>
          <strong>{data.card.title}</strong>
          {CARD_SECTIONS.map(([k, label]) => (
            <p key={k} style={{ margin: "8px 0", whiteSpace: "pre-wrap" }}><small style={{ color: "#555" }}>{label}</small><br />{data.card![k]}</p>
          ))}
          {data.card.rejectedOptions.length > 0 && <small style={{ color: "#555" }}>退けた案</small>}
          {data.card.rejectedOptions.map((r) => <p key={r.option} style={{ margin: "4px 0" }}>{r.option}：{r.reason}</p>)}
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#555" }}>{data.card.id}／{data.card.author}</p>
        </div>
      ) : (
        <p style={{ color: "#777" }}>カード準備中</p>
      )}
      <Returns prep={prep} onChange={onChange} onError={onError} />
    </>
  );
}

// 返しを用意して答え直す。新しい商談は作らず、同じ商談の続きに戻る
function Returns({ prep, onChange, onError }: Step) {
  const [returns, setReturns] = useState([0, 1, 2].map((i) => prep.returns[i] ?? ""));
  const [landing, setLanding] = useState(prep.landing);
  const ready = returns.filter((r) => r.trim()).length >= 2 && landing.trim() !== "";
  const retry = async () => {
    try {
      await call(`/api/preps/${prep.id}`, "PATCH", { returns, landing });
      onChange(await call<Prep>(`/api/preps/${prep.id}/retry`, "POST"));
      document.getElementById("practice")?.scrollIntoView();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  return (
    <>
      <h2>返しを用意する</h2>
      <p style={{ color: "#555" }}>断られても次が出せるよう、返しを2〜3本と、落としどころを書きます。「自社品を外す」は返しの1本です。</p>
      {returns.map((r, i) => (
        <label key={i} style={{ display: "block", marginBottom: 8 }}>
          返し{i + 1}{i === 2 && <small style={{ color: "#777" }}>（任意）</small>}
          <textarea value={r} onChange={(e) => setReturns(returns.map((x, j) => (j === i ? e.target.value : x)))} rows={2} style={{ width: "100%" }} />
        </label>
      ))}
      <label style={{ display: "block", marginBottom: 8 }}>
        落としどころ
        <textarea value={landing} onChange={(e) => setLanding(e.target.value)} rows={2} style={{ width: "100%" }} />
      </label>
      <button onClick={retry} disabled={!ready}>同じ商談の続きで答え直す</button>
    </>
  );
}

// 上司への相談文。上司が返事する画面は作らない。若手が持っていく1枚
function ConsultSheet({ prep, onChange, onError }: Step) {
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    onError(null);
    try {
      onChange(await call<Prep>(`/api/preps/${prep.id}/consult`, "POST"));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const c = prep.consult;
  return (
    <>
      <h2>上司への相談文</h2>
      <p style={{ color: "#555" }}>考えは一人、決めは上司。ここまで譲ってよいかを、商談の前に確かめます。</p>
      <button onClick={make} disabled={busy}>{c ? "書き直す" : "相談文を作る"}</button>
      {busy && <span style={{ marginLeft: 8 }}>書いています…</span>}
      {c && (
        <div style={box}>
          <p style={{ margin: "0 0 8px" }}><strong>{prep.accountName} {prep.buyerName}との商談（{prep.meetingOn}）の前の相談</strong></p>
          <p>{c.summary}</p>
          <p style={{ margin: "8px 0 0" }}><small style={{ color: "#555" }}>相手の得</small><br />{c.gainAnswer}</p>
          <p style={{ margin: "8px 0 0" }}><small style={{ color: "#555" }}>用意した返し</small></p>
          <ol style={{ margin: "4px 0", paddingLeft: 20 }}>
            {c.returns.map((r, i) => <li key={i}>{r}<br /><small style={{ color: "#555" }}>譲るもの：{c.concessions[i]}</small></li>)}
          </ol>
          <p style={{ margin: "8px 0 0" }}><small style={{ color: "#555" }}>落としどころ</small><br />{c.landing}</p>
          <p style={{ margin: "8px 0 0" }}><small style={{ color: "#555" }}>確かめたいこと</small></p>
          <ul style={{ margin: "4px 0", paddingLeft: 20 }}>{c.asks.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </div>
      )}
    </>
  );
}
