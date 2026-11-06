import { useState } from "react";
import { call } from "./api";
import { Button, Card, ErrorNotice, Facts, Pending, Sub, Title, Waiting, Why } from "./ui";
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

const FIELDS = ["situation", "hypothesis", "evidence", "proposal", "constraints", "result", "nextJudgment"] as const;

const MAX_STORY = 4000;
const MIN_STORY = 40;

// 取り込み：過去の商談内容・資料の文字 → 知恵カードの候補。承認は「候補の承認」で上司が行う
export function Organize({ axisName }: { axisName: (id: string) => string }) {
  const [story, setStory] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await call<{ draft: Draft }>("/api/drafts", "POST", { story });
      setDraft(data.draft);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const enough = story.trim().length >= MIN_STORY;
  const missing = (v: string) => (v.includes("語りに無い") ? <span className="muted">{v}</span> : v);

  return (
    <>
      <Card>
        <Title size="big" as="h1">{W.organize.title}</Title>
        <p className="lead">{W.organize.lead(MAX_STORY)}</p>
        <ErrorNotice message={error} />
        <textarea value={story} onChange={(e) => setStory(e.target.value)} rows={8} placeholder={W.organize.placeholder} aria-label={W.organize.label} maxLength={MAX_STORY} />
        <div className="row">
          <Button onClick={submit} disabled={busy || !enough}>{W.organize.make}</Button>
          {!enough && <Why>{W.organize.why}</Why>}
        </div>
        {busy && <Waiting>{W.state.organizing}</Waiting>}
      </Card>

      {draft && (
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
      )}
    </>
  );
}
