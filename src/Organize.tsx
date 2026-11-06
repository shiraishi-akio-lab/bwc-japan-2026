import { useEffect, useState } from "react";
import { call } from "./api";
import { Button, Card, Empty, ErrorNotice, Facts, Pending, Sub, Tag, Title, Waiting, Why, honor, personName } from "./ui";
import { W } from "./words";

type Draft = {
  title: string;
  scene: string;
  axes: string[];
  situation: string;
  hypothesis: string;
  evidence: string;
  proposal: string;
  constraints: string;
  result: string;
  nextJudgment: string;
  rejectedOptions: { option: string; reason: string }[];
  questionsForVeteran: string[];
};

type Meeting = { id: string; held_on: string; kind: string; summary: string; account_name: string; buyer_name: string; has_notes: number };

const FIELDS = ["situation", "hypothesis", "evidence", "proposal", "constraints", "result", "nextJudgment"] as const;

const MAX_STORY = 4000;
const MIN_STORY = 40;

// 取り込み：登録済みの商談か資料の文字 → 知恵カードの候補。承認は「候補の承認」で上司が行う
export function Organize({ axisName }: { axisName: (id: string) => string }) {
  const [story, setStory] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [made, setMade] = useState<string[]>([]);
  const [working, setWorking] = useState("");

  useEffect(() => {
    call<Meeting[]>("/api/drafts/meetings").then(setMeetings).catch((e: Error) => setError(e.message));
  }, []);

  const make = async (body: { story: string } | { meetingId: string }) => {
    setBusy(true);
    setError(null);
    try {
      const data = await call<{ draft: Draft }>("/api/drafts", "POST", body);
      setDraft(data.draft);
      if ("meetingId" in body) setMade((m) => [...m, body.meetingId]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setWorking("");
    }
  };
  const submit = () => make({ story });
  const fromMeeting = (id: string) => { setWorking(id); return make({ meetingId: id }); };

  const enough = story.trim().length >= MIN_STORY;
  const missing = (v: string) => (v.includes("語りに無い") ? <span className="muted">{v}</span> : v);
  const DraftCard = draft && (
    <Card>
      <div className="row"><Pending /><small>{W.organize.pending}｜{draft.scene}｜{draft.axes.map(axisName).join("・")}</small></div>
      <h3 className="item">{draft.title}</h3>
      <Facts two rows={[
        ...FIELDS.map((k): [string, React.ReactNode] => [W.manager.sections[k], missing(String(draft[k]))]),
        [W.organize.rejected, draft.rejectedOptions.length === 0
          ? <span className="muted">{W.organize.notInStory}</span>
          : draft.rejectedOptions.map((r, i) => <div key={i}>{r.option}——{r.reason}</div>)],
      ]} />
      {draft.questionsForVeteran.length > 0 && (
        <div className="stack">
          <Sub>{W.organize.questions}</Sub>
          {draft.questionsForVeteran.map((q, i) => <p key={i}>・{q}</p>)}
        </div>
      )}
    </Card>
  );

  return (
    <>
      <Card>
        <Title size="big" as="h1">{W.organize.fromTitle}</Title>
        <p className="lead">{W.organize.fromLead}</p>
        <ErrorNotice message={error} />
        {meetings?.length === 0 && <Empty>{W.organize.noMeetings}</Empty>}
        {meetings?.map((m) => (
          <div key={m.id} className="box">
            <div className="row">
              <span className="muted">{m.held_on} {m.kind}</span>
              <Tag kind={m.has_notes ? "soft" : "wait"}>{m.has_notes ? W.organize.hasNotes : W.organize.summaryOnly}</Tag>
            </div>
            <strong>{personName(m.account_name)} {honor(personName(m.buyer_name))}</strong>
            <p>{m.summary}</p>
            <div className="row">
              <Button small onClick={() => void fromMeeting(m.id)} disabled={busy || made.includes(m.id)}>{made.includes(m.id) ? W.organize.made : W.organize.make}</Button>
              {working === m.id && <Waiting>{W.state.organizing}</Waiting>}
            </div>
          </div>
        ))}
      </Card>

      {draft && DraftCard}

      <Card>
        <Title size="mid">{W.organize.title}</Title>
        <p className="muted">{W.organize.lead(MAX_STORY)}</p>
        <textarea value={story} onChange={(e) => setStory(e.target.value)} rows={8} placeholder={W.organize.placeholder} aria-label={W.organize.label} maxLength={MAX_STORY} />
        <div className="row">
          <Button onClick={submit} disabled={busy || !enough}>{W.organize.make}</Button>
          {!enough && <Why>{W.organize.why}</Why>}
        </div>
        {busy && !working && <Waiting>{W.state.organizing}</Waiting>}
      </Card>
    </>
  );
}
