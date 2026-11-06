import { useEffect, useState } from "react";
import { Accounts, type View } from "./Accounts";
import { call } from "./api";
import { useMe } from "./me";
import { PrepRoom } from "./Prep";
import { Recording } from "./Recording";
import { Shell } from "./Shell";
import { Band, Button, Card, Chat, ErrorNotice, LinkButton, Sub, Tag, Title, Waiting, Why, honor, personName, type Turn } from "./ui";
import { W } from "./words";

type Axis = { id: string; name: string; question: string };
type AxisResult = {
  axis: string;
  done: { text: string; quote: string }[];
  missing: { text: string; caseIds: string[] }[];
  unknown: boolean;
};
type NextAction = { axis: string; action: string; reason: string; caseId: string; tryLine: string; otherCount: number; insufficient?: boolean };
type BuyerOption = { id: string; name: string; role: string; account_name: string };

export function App({ onLogout }: { onLogout: () => void }) {
  const me = useMe();
  const [axes, setAxes] = useState<Axis[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [memo, setMemo] = useState({ facts: "", interpretation: "", nextCheck: "" });
  const [result, setResult] = useState<AxisResult[] | null>(null);
  const [next, setNext] = useState<NextAction | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [mode, setMode] = useState<"prep" | "practice" | "recording" | "accounts">("prep");
  const [view, setView] = useState<View>({ name: "list" });
  const [buyers, setBuyers] = useState<BuyerOption[]>([]);
  const [buyerId, setBuyerId] = useState("buyer-saeki");
  const [useRecord, setUseRecord] = useState(true);
  const [buyerName, setBuyerName] = useState("バイヤー役");
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [fromPrep, setFromPrep] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false); // 会話の次の 3分メモの段にいるか
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<Axis[]>("/api/rubric").then(setAxes).catch((e: Error) => setError(e.message));
    call<BuyerOption[]>("/api/buyers").then(setBuyers).catch((e: Error) => setError(e.message));
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
      const s = await call<{ id: string; turns: Turn[]; buyerName: string }>("/api/practice", "POST", { buyerId, useRecord });
      setSessionId(s.id);
      setTurns(s.turns);
      setBuyerName(s.buyerName);
      setMeetingId(null);
      setIsRecording(false);
      setFromPrep(false);
      setMemoOpen(false);
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
    setMemoOpen(true);
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
    setMemoOpen(true);
    setResult(null);
    setNext(null);
    setMode("practice");
  };

  const send = () =>
    run(async () => {
      const r = await call<{ turns: Turn[] }>(`/api/practice/${sessionId}/turn`, "POST", { text: draft });
      setTurns(r.turns);
      setDraft("");
    });

  const checkIt = () =>
    run(async () => {
      const r = await call<{ axes: AxisResult[]; next: NextAction }>(`/api/practice/${sessionId}/check`, "POST", memo);
      setResult(r.axes);
      setNext(r.next);
      setShowMap(false);
      window.scrollTo(0, 0);
    });

  const axisName = (id: string) => axes.find((a) => a.id === id)?.name ?? id;
  const n = W.nav.rep;
  const buyerLabel = isRecording ? W.practice.buyer : W.talk.buyerRole(personName(buyerName));
  const spoke = turns.some((t) => t.role === "rep");
  const self = W.band.self(honor(personName(me.displayName)));

  return (
    <Shell
      items={[["prep", n.prep], ["practice", n.practice], ["recording", n.recording], ["accounts", n.accounts]]}
      current={mode}
      onGo={(m) => { if (m === "accounts") setView({ name: "list" }); setMode(m); }}
      onLogout={onLogout}
    >
      {mode === "prep" && <PrepRoom onReview={fromPrepRoom} />}

      {mode === "recording" && (
        <>
          <Band kind="self" right={self} />
          <main className="page"><Recording buyers={buyers} onReady={fromRecording} /></main>
        </>
      )}

      {mode === "accounts" && (
        <>
          <Band kind="boss" right={W.band.shared} />
          <main className="page">
            <Accounts view={view} setView={setView} onPractice={(id) => { setBuyerId(id); setSessionId(null); setMemoOpen(false); setResult(null); setNext(null); setMode("practice"); }} />
          </main>
        </>
      )}

      {mode === "practice" && (
        <>
          <Band kind="self" right={self} />
          <main className="page">
            <ErrorNotice message={error} />

            {!sessionId && (
              <Card>
                <Title size="big" as="h1">{W.practice.scene}</Title>
                <p className="lead">{W.practice.sceneLead}</p>
                <div className="row-end">
                  <label className="field">
                    {W.practice.partner}
                    <select value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
                      {buyers.map((b) => <option key={b.id} value={b.id}>{personName(b.account_name)} {honor(personName(b.name))}</option>)}
                    </select>
                  </label>
                  <Button onClick={start} disabled={busy}>{W.practice.start}</Button>
                </div>
                <label className="check">
                  <input type="checkbox" checked={useRecord} onChange={(e) => setUseRecord(e.target.checked)} />
                  <span>{W.practice.useRecord}</span>
                </label>
                {busy && <Waiting>{W.state.thinking}</Waiting>}
              </Card>
            )}

            {sessionId && !memoOpen && !next && (
              <Card>
                <Title size="big" as="h1">{W.practice.talk}</Title>
                <Chat turns={turns} buyerLabel={buyerLabel} />
                <div className="say-input">
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder={W.talk.placeholder} aria-label={W.talk.placeholder} />
                  <Button onClick={send} disabled={busy || !draft.trim()}>{W.talk.say}</Button>
                </div>
                {busy && <Waiting>{W.state.thinking}</Waiting>}
                <div className="step-nav-right">
                  {!spoke && <Why>{W.practice.memoWhy}</Why>}
                  <Button ghost onClick={() => { setMemoOpen(true); window.scrollTo(0, 0); }} disabled={!spoke}>{W.practice.toMemo}</Button>
                </div>
              </Card>
            )}

            {sessionId && memoOpen && !next && (
              <>
                {meetingId && (
                  <Card>
                    <div className="row">
                      <span>{W.practice.meetingDraft}</span>
                      <Button small ghost onClick={() => { setView({ name: "meeting", id: meetingId }); setMode("accounts"); }}>{W.practice.openMeeting}</Button>
                    </div>
                  </Card>
                )}
                <Card>
                  <Title size="big" as="h1">{W.practice.memo}</Title>
                  <p className="lead">{W.practice.memoLead}</p>
                  {(
                    [
                      ["facts", W.practice.facts],
                      ["interpretation", W.practice.interpretation],
                      ["nextCheck", W.practice.nextCheck],
                    ] as const
                  ).map(([k, label]) => (
                    <label key={k} className="field">
                      {label}
                      <textarea value={memo[k]} onChange={(e) => setMemo({ ...memo, [k]: e.target.value })} rows={3} />
                    </label>
                  ))}
                  <div className="row">
                    <Button onClick={checkIt} disabled={busy || !spoke}>{W.practice.check}</Button>
                    {!isRecording && !fromPrep && <Button ghost onClick={() => setMemoOpen(false)} disabled={busy}>{W.practice.backTalk}</Button>}
                    {busy && <Waiting>{W.state.thinking}</Waiting>}
                  </div>
                </Card>
                <Card>
                  <details>
                    <summary>{isRecording ? W.practice.fromRecording : fromPrep ? W.practice.fromPrep : W.practice.showTalk}</summary>
                    <div style={{ marginTop: 12 }}><Chat turns={turns} buyerLabel={buyerLabel} /></div>
                  </details>
                </Card>
              </>
            )}

            {next && (
              <Card>
                <Title size="big" as="h1">{W.practice.next}</Title>
                {!next.insufficient && <div><Tag kind="soft">{axisName(next.axis)}</Tag></div>}
                <p className="ask-q">{next.action}</p>
                <p>{W.practice.tryLine(next.tryLine)}</p>
                <p className="muted">
                  {W.practice.why}：{next.reason}
                  {next.caseId && <><br />{W.practice.example}：{next.caseId}</>}
                </p>
                <p className="small">
                  {W.practice.others(next.otherCount)}{" "}
                  <LinkButton onClick={() => setShowMap(!showMap)}>{showMap ? W.practice.closeMap : W.practice.openMap}</LinkButton>
                </p>
                <div className="row">
                  <Button onClick={start} disabled={busy}>{W.practice.again}</Button>
                  <Button ghost onClick={() => { setNext(null); setResult(null); setMemoOpen(true); }} disabled={busy}>{W.practice.editMemo}</Button>
                </div>
                <details>
                  <summary>{W.practice.showTalk}</summary>
                  <div style={{ marginTop: 12 }}><Chat turns={turns} buyerLabel={buyerLabel} /></div>
                </details>
              </Card>
            )}

            {result && showMap && (
              <Card>
                <Title>{W.practice.map}</Title>
                <p className="muted">{W.practice.mapLead}</p>
                {result.map((a) => (
                  <div key={a.axis} className="box">
                    <Sub>{axisName(a.axis)}</Sub>
                    {a.unknown ? (
                      <p className="muted">{W.practice.unknown}</p>
                    ) : (
                      <>
                        {a.done.length > 0 && <strong>{W.practice.done}</strong>}
                        {a.done.map((d, i) => <p key={`d${i}`}>{d.text}<br /><small>{W.practice.quote}：「{d.quote}」</small></p>)}
                        {a.missing.length > 0 && <strong>{W.practice.missing}</strong>}
                        {a.missing.map((m, i) => <p key={`m${i}`}>{m.text}{m.caseIds.length > 0 && <><br /><small>{W.practice.ground}：{m.caseIds.join("、")}</small></>}</p>)}
                      </>
                    )}
                  </div>
                ))}
              </Card>
            )}
          </main>
        </>
      )}
    </Shell>
  );
}
