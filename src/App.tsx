import { useEffect, useState } from "react";
import { Accounts, type View } from "./Accounts";
import { Organize } from "./Organize";
import { PrepRoom } from "./Prep";
import { Recording } from "./Recording";

type Turn = { role: "rep" | "buyer"; content: string };
type Axis = { id: string; name: string; question: string };
type AxisResult = {
  axis: string;
  done: { text: string; quote: string }[];
  missing: { text: string; caseIds: string[] }[];
  unknown: boolean;
};
type NextAction = { axis: string; action: string; reason: string; caseId: string; tryLine: string; otherCount: number; insufficient?: boolean };
type BuyerOption = { id: string; name: string; role: string; account_name: string };

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}

export function App() {
  const [axes, setAxes] = useState<Axis[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [memo, setMemo] = useState({ facts: "", interpretation: "", nextCheck: "" });
  const [result, setResult] = useState<AxisResult[] | null>(null);
  const [next, setNext] = useState<NextAction | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [mode, setMode] = useState<"prep" | "practice" | "recording" | "organize" | "accounts">("prep");
  const [view, setView] = useState<View>({ name: "list" });
  const [buyers, setBuyers] = useState<BuyerOption[]>([]);
  const [buyerId, setBuyerId] = useState("buyer-saeki");
  const [useRecord, setUseRecord] = useState(true);
  const [buyerName, setBuyerName] = useState("バイヤー役");
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [fromPrep, setFromPrep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Axis[]>("/api/rubric").then(setAxes).catch((e: Error) => setError(e.message));
    api<BuyerOption[]>("/api/buyers").then(setBuyers).catch((e: Error) => setError(e.message));
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      const s = await api<{ id: string; turns: Turn[]; buyerName: string }>("/api/practice", { buyerId, useRecord });
      setSessionId(s.id);
      setTurns(s.turns);
      setBuyerName(s.buyerName);
      setMeetingId(null);
      setIsRecording(false);
      setFromPrep(false);
      setResult(null);
      setNext(null);
    });

  // 本番の文字起こしを読み込んだら、練習と同じ画面で「確かめる」に進む
  const fromRecording = (id: string, t: Turn[], meeting: string | null) => {
    setMeetingId(meeting);
    setSessionId(id);
    setTurns(t);
    setIsRecording(true);
    setFromPrep(false);
    setResult(null);
    setNext(null);
    setMode("practice");
  };

  // 準備室の練習を、今までと同じ3分メモ・確かめる・次の一行動で振り返る
  const fromPrepRoom = (id: string, t: Turn[], name: string) => {
    setMeetingId(null);
    setSessionId(id);
    setTurns(t);
    setBuyerName(name);
    setIsRecording(false);
    setFromPrep(true);
    setResult(null);
    setNext(null);
    setMode("practice");
  };

  const send = () =>
    run(async () => {
      const r = await api<{ turns: Turn[] }>(`/api/practice/${sessionId}/turn`, { text: draft });
      setTurns(r.turns);
      setDraft("");
    });

  const checkIt = () =>
    run(async () => {
      const r = await api<{ axes: AxisResult[]; next: NextAction }>(`/api/practice/${sessionId}/check`, memo);
      setResult(r.axes);
      setNext(r.next);
      setShowMap(false);
    });

  const axisName = (id: string) => axes.find((a) => a.id === id)?.name ?? id;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 760, margin: "32px auto", padding: "0 16px", lineHeight: 1.6 }}>
      <h1 style={{ marginBottom: 4 }}>隣席コーチ</h1>
      <p style={{ marginTop: 0, color: "#555" }}>商談の数日前に、得意先の得から話す準備をする。結果は本人だけが見る。</p>
      <nav style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button onClick={() => setMode("prep")} disabled={mode === "prep"}>若手：商談の準備</button>
        <button onClick={() => setMode("practice")} disabled={mode === "practice"}>若手：練習する</button>
        <button onClick={() => setMode("recording")} disabled={mode === "recording"}>若手：本番を振り返る</button>
        <button onClick={() => setMode("organize")} disabled={mode === "organize"}>ベテラン：語りを残す</button>
        <button onClick={() => { setView({ name: "list" }); setMode("accounts"); }} disabled={mode === "accounts"}>取引先の記録</button>
      </nav>

      {mode === "prep" && <PrepRoom onReview={fromPrepRoom} />}
      {mode === "organize" && <Organize axisName={axisName} />}
      {mode === "recording" && <Recording buyers={buyers} onReady={fromRecording} />}
      {mode === "accounts" && (
        <Accounts view={view} setView={setView} onPractice={(id) => { setBuyerId(id); setSessionId(null); setResult(null); setNext(null); setMode("practice"); }} />
      )}

      {mode === "practice" && <>
      {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}

      {!sessionId && (
        <section>
          <h2>今日の場面（架空）</h2>
          <p>ミズナギ飲料の森川として、取引先のバイヤーに3月の棚割りを提案します。</p>
          <label style={{ display: "block", marginBottom: 8 }}>
            相手{" "}
            <select value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
              {buyers.map((b) => <option key={b.id} value={b.id}>{b.account_name}　{b.name}</option>)}
            </select>
          </label>
          <label style={{ display: "block", marginBottom: 8 }}>
            <input type="checkbox" checked={useRecord} onChange={(e) => setUseRecord(e.target.checked)} /> 取引先の記録を使う
          </label>
          <button onClick={start} disabled={busy}>練習を始める</button>
        </section>
      )}

      {sessionId && (
        <section>
          <h2>{isRecording ? "1. 本番の商談（文字起こし）" : fromPrep ? "1. 準備室の練習" : "1. 練習"}</h2>
          {meetingId && (
            <p style={{ fontSize: 14 }}>
              議事録の下書きを作りました。
              <button onClick={() => { setView({ name: "meeting", id: meetingId }); setMode("accounts"); }} style={{ marginLeft: 8 }}>議事録を開く</button>
            </p>
          )}
          <ol style={{ listStyle: "none", padding: 0 }}>
            {turns.map((t, i) => (
              <li key={i} style={{ margin: "8px 0", textAlign: t.role === "rep" ? "right" : "left" }}>
                <span style={{ fontSize: 12, color: "#777" }}>{t.role === "rep" ? "あなた" : isRecording ? "バイヤー" : `${buyerName}（バイヤー役）`}</span>
                <div style={{ display: "inline-block", padding: "8px 12px", borderRadius: 8, background: t.role === "rep" ? "#e8f0fe" : "#f1f3f4", maxWidth: "85%", textAlign: "left" }}>
                  {t.content}
                </div>
              </li>
            ))}
          </ol>
          {!isRecording && !fromPrep && <>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} style={{ width: "100%" }} placeholder="あなたの発言" />
          <button onClick={send} disabled={busy || !draft.trim()}>話す</button>
          </>}

          <h2>2. 3分メモ</h2>
          {(
            [
              ["facts", "事実（相手が言ったこと）"],
              ["interpretation", "解釈（自分はどう受け取ったか）"],
              ["nextCheck", "次に確かめること"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} style={{ display: "block", marginBottom: 8 }}>
              {label}
              <textarea value={memo[k]} onChange={(e) => setMemo({ ...memo, [k]: e.target.value })} rows={2} style={{ width: "100%" }} />
            </label>
          ))}
          <button onClick={checkIt} disabled={busy || !turns.some((t) => t.role === "rep")}>確かめる</button>
          {busy && <p>考えています…</p>}
        </section>
      )}

      {next && (
        <section>
          <h2>3. 次に鍛える一行動</h2>
          <div style={{ border: "2px solid #1a73e8", borderRadius: 8, padding: 16 }}>
            {!next.insufficient && <small style={{ color: "#555" }}>{axisName(next.axis)}</small>}
            <p style={{ fontSize: 18, fontWeight: 600, margin: "4px 0 8px" }}>{next.action}</p>
            <p style={{ margin: "0 0 8px" }}>次の練習で言ってみる：「{next.tryLine}」</p>
            <p style={{ margin: 0, fontSize: 14, color: "#444" }}>
              なぜ今これか：{next.reason}
              {next.caseId && <><br />手本：{next.caseId}</>}
            </p>
          </div>
          <p style={{ fontSize: 13, color: "#555" }}>
            ほかに気づいた点が {next.otherCount} 件あります。今は1つに絞っています。
            <button onClick={() => setShowMap(!showMap)} style={{ marginLeft: 8 }}>{showMap ? "閉じる" : "理解の地図を見る"}</button>
          </p>
        </section>
      )}

      {result && showMap && (
        <section>
          <h2>理解の地図</h2>
          <p style={{ fontSize: 13, color: "#555" }}>点数は出しません。根拠は、あなたの発言の引用と、ベテランのケースカードの番号です。</p>
          {result.map((a) => (
            <div key={a.axis} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, margin: "8px 0" }}>
              <strong>{axisName(a.axis)}</strong>
              {a.unknown ? (
                <p style={{ color: "#777" }}>不明（この練習からは判断できません）</p>
              ) : (
                <>
                  {a.done.map((d, i) => (
                    <p key={`d${i}`}>✓ {d.text}<br /><small>引用：「{d.quote}」</small></p>
                  ))}
                  {a.missing.map((m, i) => (
                    <p key={`m${i}`}>△ {m.text}{m.caseIds.length > 0 && <><br /><small>根拠：{m.caseIds.join("、")}</small></>}</p>
                  ))}
                </>
              )}
            </div>
          ))}
        </section>
      )}

      {next && <button onClick={start} disabled={busy}>もう一度練習する</button>}
      </>}
    </main>
  );
}
