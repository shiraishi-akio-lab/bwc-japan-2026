import { useState } from "react";
import { noticeExpired } from "./me";
import { Button, Card, ErrorNotice, Title, Waiting, Why, honor, personName, type Turn } from "./ui";
import { W } from "./words";
import sample from "../samples/transcript-sample.txt?raw";

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

  const enough = text.trim().length >= 40;
  return (
    <Card>
      <Title size="big" as="h1">{W.recording.title}</Title>
      <p className="lead">{W.recording.lead}</p>
      <ErrorNotice message={error} />
      <div className="row-end">
        <label className="field">
          {W.recording.partner}
          <select value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
            <option value="">{W.recording.noPartner}</option>
            {buyers.map((b) => <option key={b.id} value={b.id}>{personName(b.account_name)} {honor(personName(b.name))}</option>)}
          </select>
        </label>
        <label className="field">{W.recording.date}<input type="date" value={heldOn} onChange={(e) => setHeldOn(e.target.value)} /></label>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} placeholder={W.recording.text} aria-label={W.recording.text} />
      <div className="row">
        <Button onClick={submit} disabled={busy || !enough}>{W.recording.load}</Button>
        <Button ghost onClick={() => setText(sample)} disabled={busy}>{W.recording.sample}</Button>
        {!enough && <Why>{W.recording.why}</Why>}
      </div>
      {busy && <Waiting>{W.recording.busy}</Waiting>}
    </Card>
  );
}
