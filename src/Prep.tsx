import { useCallback, useEffect, useState } from "react";
import { box, call, link } from "./Accounts";

type Turn = { role: "rep" | "buyer"; content: string };
type BuyerOption = { id: string; name: string; role: string; account_name: string };
type PrepRow = { id: string; meeting_on: string; stage: string; buyer_name: string; account_name: string };
type Prep = {
  id: string; sessionId: string; buyerId: string; buyerName: string; accountName: string; meetingOn: string;
  gainAnswer: string; causeHypothesis: string; returns: string[]; landing: string; stage: string; turns: Turn[];
};

const prepIdFromHash = () => window.location.hash.match(/^#prep=(.+)$/)?.[1] ?? null;

// 商談前の準備室。再読み込みしても続きから開けるよう、準備の id を URL に持つ
export function PrepRoom() {
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
          <Gain prep={prep} onChange={setPrep} onError={setError} />
          {prep.gainAnswer && <Practice prep={prep} onChange={setPrep} onError={setError} />}
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
      <h2>止まる練習</h2>
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
