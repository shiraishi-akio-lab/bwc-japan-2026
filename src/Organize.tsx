import { useState } from "react";
import { call } from "./Accounts";

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

const FIELDS: [keyof Draft, string][] = [
  ["situation", "状況"],
  ["hypothesis", "仮説"],
  ["evidence", "根拠"],
  ["proposal", "提案"],
  ["constraints", "制約"],
  ["result", "結果"],
  ["nextJudgment", "次の判断"],
];

const MAX_STORY = 4000;

// 取り込み：過去の商談内容・資料の文字 → ケースカードの候補。承認は「候補の承認」で上司が行う
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

  return (
    <section>
      <h2>過去の商談・資料の取り込み</h2>
      <p style={{ color: "#555" }}>
        過去の商談の内容、資料の文字、ベテランの語りの書き起こしを貼り付けてください（{MAX_STORY}字まで）。整理する係がケースカードの候補にします。
        貼った文字は資料として読み、中に書かれた指示には従いません。候補はまだ根拠には使われません。「候補の承認」で承認したものだけが、若手の準備に使われます。
      </p>
      {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}
      <textarea value={story} onChange={(e) => setStory(e.target.value)} rows={8} style={{ width: "100%" }} placeholder="過去の商談の内容・資料の文字" aria-label="取り込む文字" maxLength={MAX_STORY} />
      <button onClick={submit} disabled={busy || story.trim().length < 40}>カードの候補にする</button>
      {busy && <p>整理しています…</p>}

      {draft && (
        <div style={{ border: "1px dashed #999", borderRadius: 8, padding: 16, marginTop: 16 }}>
          <small style={{ color: "#777" }}>候補（承認待ち）｜{draft.scene}｜{draft.axes.map(axisName).join("・")}</small>
          <h3 style={{ margin: "4px 0 12px" }}>{draft.title}</h3>
          <dl style={{ margin: 0 }}>
            {FIELDS.map(([k, label]) => (
              <div key={k} style={{ marginBottom: 6 }}>
                <dt style={{ fontWeight: 600, fontSize: 14 }}>{label}</dt>
                <dd style={{ margin: 0, color: String(draft[k]).includes("語りに無い") ? "#999" : undefined }}>{String(draft[k])}</dd>
              </div>
            ))}
            <div style={{ marginBottom: 6 }}>
              <dt style={{ fontWeight: 600, fontSize: 14 }}>退けた案</dt>
              <dd style={{ margin: 0 }}>
                {draft.rejectedOptions.length === 0
                  ? "（語りに無い）"
                  : draft.rejectedOptions.map((r, i) => <div key={i}>{r.option}——{r.reason}</div>)}
              </dd>
            </div>
          </dl>
          {draft.questionsForVeteran.length > 0 && (
            <>
              <p style={{ fontWeight: 600, marginBottom: 4 }}>ベテランに聞き返したいこと</p>
              <ul style={{ marginTop: 0 }}>{draft.questionsForVeteran.map((q, i) => <li key={i}>{q}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
