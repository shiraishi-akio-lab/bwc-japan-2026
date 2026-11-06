import { useState } from "react";
import { noticeExpired } from "./me";
import sample from "../samples/transcript-sample.txt?raw";

type Turn = { role: "rep" | "buyer"; content: string };

// 本番の商談のあと：録音アプリで話者分けした文字起こしを貼る。録音そのものは受け取らない
type BuyerOption = { id: string; name: string; account_name: string };

export function Recording({ buyers, onReady }: { buyers: BuyerOption[]; onReady: (id: string, turns: Turn[], meetingId: string | null) => void }) {
  const [text, setText] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [heldOn, setHeldOn] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/recordings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript: text, buyerId: buyerId || undefined, heldOn }),
      });
      noticeExpired(r.status);
      const data = (await r.json()) as { id?: string; turns?: Turn[]; meetingId?: string | null; error?: string };
      if (!r.ok || !data.id || !data.turns) throw new Error(data.error ?? `HTTP ${r.status}`);
      onReady(data.id, data.turns, data.meetingId ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>本番の商談を振り返る</h2>
      <p style={{ color: "#555" }}>
        録音アプリ（例：Klang）で話者分けした文字起こしを貼ってください。練習と同じように、確かめて、次に鍛える一行動を1つ出します。
        録音そのものは受け取りません。相手の方の同意を得た録音だけを使ってください。
      </p>
      {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <label>
          相手{" "}
          <select value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
            <option value="">選ばない（議事録は残さない）</option>
            {buyers.map((b) => <option key={b.id} value={b.id}>{b.account_name}　{b.name}</option>)}
          </select>
        </label>
        <label>商談の日 <input type="date" value={heldOn} onChange={(e) => setHeldOn(e.target.value)} /></label>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} style={{ width: "100%" }} placeholder="話者分けした文字起こし" />
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={submit} disabled={busy || text.trim().length < 40}>読み込む</button>
        <button onClick={() => setText(sample)} disabled={busy}>見本（架空）を入れる</button>
      </div>
      {busy && <p>発言を若手とバイヤーに分けて、議事録の下書きを作っています…</p>}
    </section>
  );
}
