import { useEffect, useState } from "react";

type Turn = { role: "rep" | "buyer"; content: string };
type Axis = { id: string; name: string; question: string };
type AxisResult = {
  axis: string;
  done: { text: string; quote: string }[];
  missing: { text: string; caseIds: string[] }[];
  unknown: boolean;
};

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Axis[]>("/api/rubric").then(setAxes).catch((e: Error) => setError(e.message));
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
      const s = await api<{ id: string; turns: Turn[] }>("/api/practice", {});
      setSessionId(s.id);
      setTurns(s.turns);
      setResult(null);
    });

  const send = () =>
    run(async () => {
      const r = await api<{ turns: Turn[] }>(`/api/practice/${sessionId}/turn`, { text: draft });
      setTurns(r.turns);
      setDraft("");
    });

  const checkIt = () =>
    run(async () => {
      const r = await api<{ axes: AxisResult[] }>(`/api/practice/${sessionId}/check`, memo);
      setResult(r.axes);
    });

  const axisName = (id: string) => axes.find((a) => a.id === id)?.name ?? id;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 760, margin: "32px auto", padding: "0 16px", lineHeight: 1.6 }}>
      <h1 style={{ marginBottom: 4 }}>隣席コーチ（仮）</h1>
      <p style={{ marginTop: 0, color: "#555" }}>商談の前に5分、バイヤーを相手に練習する。結果は本人だけが見る。</p>
      {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}

      {!sessionId && (
        <section>
          <h2>今日の場面（架空）</h2>
          <p>ミズナギ飲料の森川として、ハルカゼドラッグのバイヤー佐伯さんに、新商品「和ハーブ炭酸」を初めて提案します。</p>
          <button onClick={start} disabled={busy}>練習を始める</button>
        </section>
      )}

      {sessionId && (
        <section>
          <h2>1. 練習</h2>
          <ol style={{ listStyle: "none", padding: 0 }}>
            {turns.map((t, i) => (
              <li key={i} style={{ margin: "8px 0", textAlign: t.role === "rep" ? "right" : "left" }}>
                <span style={{ fontSize: 12, color: "#777" }}>{t.role === "rep" ? "あなた" : "佐伯（バイヤー役）"}</span>
                <div style={{ display: "inline-block", padding: "8px 12px", borderRadius: 8, background: t.role === "rep" ? "#e8f0fe" : "#f1f3f4", maxWidth: "85%", textAlign: "left" }}>
                  {t.content}
                </div>
              </li>
            ))}
          </ol>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} style={{ width: "100%" }} placeholder="あなたの発言" />
          <button onClick={send} disabled={busy || !draft.trim()}>話す</button>

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

      {result && (
        <section>
          <h2>3. 理解の地図</h2>
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
          <button onClick={start} disabled={busy}>もう一度練習する</button>
        </section>
      )}
    </main>
  );
}
