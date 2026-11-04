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
