import { useCallback, useEffect, useState } from "react";
import { Accounts, box, call, type View } from "./Accounts";
import { InterestsPanel } from "./Counterpart";
import { Organize } from "./Organize";

type Consult = {
  id: string; repName: string; buyerName: string; accountName: string; meetingOn: string; submittedAt: string;
  summary: string; gainAnswer: string; returns: string[]; concessions: string[]; landing: string; asks: string[];
};
type Draft = {
  id: string; createdAt: string;
  card: { title: string; scene: string; appliesWhen: string; situation: string; hypothesis: string; evidence: string; proposal: string; constraints: string; result: string; nextJudgment: string };
};
type AccountRow = { id: string; name: string };
type AccountDetail = { account: { site_url: string } };
type Rubric = { id: string; name: string };
type OnError = (m: string | null) => void;

const small = { color: "#555" } as const;

// 部下から届いた相談文。若手が「上司に出す」を押したものだけ。練習の中身はここに来ない
function Consults({ onError }: { onError: OnError }) {
  const [rows, setRows] = useState<Consult[] | null>(null);
  useEffect(() => {
    call<Consult[]>("/api/consults").then(setRows).catch((e: Error) => onError(e.message));
  }, [onError]);
  return (
    <>
      <h2>部下からの相談文</h2>
      <p style={small}>商談の前に、ここまで譲ってよいかを確かめるための1枚です。練習の内容はここには出ません。</p>
      {rows?.length === 0 && <p style={{ color: "#777" }}>届いた相談文はありません。</p>}
      {rows?.map((c) => (
        <div key={c.id} style={box}>
          <p style={{ margin: "0 0 8px" }}><strong>{c.repName}：{c.accountName} {c.buyerName}との商談（{c.meetingOn}）の前の相談</strong></p>
          <p>{c.summary}</p>
          <p style={{ margin: "8px 0 0" }}><small style={small}>相手の得</small><br />{c.gainAnswer}</p>
          <p style={{ margin: "8px 0 0" }}><small style={small}>用意した返し</small></p>
          <ol style={{ margin: "4px 0", paddingLeft: 20 }}>
            {c.returns.map((r, i) => <li key={i}>{r}<br /><small style={small}>譲るもの：{c.concessions[i]}</small></li>)}
          </ol>
          <p style={{ margin: "8px 0 0" }}><small style={small}>落としどころ</small><br />{c.landing}</p>
          <p style={{ margin: "8px 0 0" }}><small style={small}>確かめたいこと</small></p>
          <ul style={{ margin: "4px 0", paddingLeft: 20 }}>{c.asks.map((a, i) => <li key={i}>{a}</li>)}</ul>
          <small style={small}>届いた日時 {c.submittedAt}（UTC）</small>
        </div>
      ))}
    </>
  );
}

const CARD_SECTIONS = [
  ["appliesWhen", "効く条件"], ["situation", "状況"], ["hypothesis", "仮説"], ["evidence", "根拠"], ["proposal", "提案"],
  ["constraints", "制約"], ["result", "結果"], ["nextJudgment", "次の判断"],
] as const;

function CardCandidates({ onError }: { onError: OnError }) {
  const [rows, setRows] = useState<Draft[]>([]);
  const load = useCallback(() => call<Draft[]>("/api/drafts").then(setRows).catch((e: Error) => onError(e.message)), [onError]);
  useEffect(() => { void load(); }, [load]);
  const judge = (id: string, status: string) => call(`/api/drafts/${id}`, "POST", { status }).then(load).catch((e: Error) => onError(e.message));
  return (
    <>
      <h2>カードの候補</h2>
      <p style={small}>承認すると、準備室のベテランの判断に出て、確かめる係の根拠にも使われます。</p>
      {rows.length === 0 && <p style={{ color: "#777" }}>承認待ちの候補はありません。</p>}
      {rows.map((d) => (
        <div key={d.id} style={{ ...box, borderColor: "#f0c36d" }}>
          <small style={small}>{d.card.scene}</small>
          <div><strong>{d.card.title}</strong></div>
          {CARD_SECTIONS.map(([k, label]) => <p key={k} style={{ margin: "4px 0" }}><small style={small}>{label}</small><br />{d.card[k]}</p>)}
          <button onClick={() => judge(d.id, "approved")}>承認</button>{" "}
          <button onClick={() => judge(d.id, "rejected")}>見送り</button>
        </div>
      ))}
    </>
  );
}

function InterestCandidates({ onError }: { onError: OnError }) {
  const [accounts, setAccounts] = useState<(AccountRow & { siteUrl: string })[]>([]);
  useEffect(() => {
    call<AccountRow[]>("/api/accounts")
      .then((rows) => Promise.all(rows.map(async (a) => ({ ...a, siteUrl: (await call<AccountDetail>(`/api/accounts/${a.id}`)).account.site_url }))))
      .then((rows) => setAccounts(rows.filter((a) => a.siteUrl)))
      .catch((e: Error) => onError(e.message));
  }, [onError]);
  return (
    <>
      {accounts.map((a) => (
        <section key={a.id}>
          <h2>{a.name}の関心</h2>
          <InterestsPanel accountId={a.id} siteUrl={a.siteUrl} onError={onError} />
        </section>
      ))}
    </>
  );
}

export function Manager() {
  const [mode, setMode] = useState<"consults" | "candidates" | "import" | "accounts">("consults");
  const [view, setView] = useState<View>({ name: "list" });
  const [axes, setAxes] = useState<Rubric[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    call<Rubric[]>("/api/rubric").then(setAxes).catch((e: Error) => setError(e.message));
  }, []);
  const go = (m: typeof mode) => {
    setError(null);
    setMode(m);
  };
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 760, margin: "32px auto", padding: "0 16px", lineHeight: 1.6 }}>
      <h1 style={{ marginBottom: 4 }}>営業GYM</h1>
      <p style={{ marginTop: 0, color: "#555" }}>部下の相談文を読み、候補を確かめる。部下の練習の内容と振り返りは、本人だけが見ます。</p>
      <nav style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button onClick={() => go("consults")} disabled={mode === "consults"}>相談文</button>
        <button onClick={() => go("candidates")} disabled={mode === "candidates"}>候補の承認</button>
        <button onClick={() => go("import")} disabled={mode === "import"}>取り込み</button>
        <button onClick={() => { setView({ name: "list" }); go("accounts"); }} disabled={mode === "accounts"}>取引先の記録</button>
      </nav>
      {error && <p role="alert" style={{ color: "#b00020" }}>{error}</p>}
      {mode === "consults" && <Consults onError={setError} />}
      {mode === "candidates" && <><CardCandidates onError={setError} /><InterestCandidates onError={setError} /></>}
      {mode === "import" && <Organize axisName={(id) => axes.find((a) => a.id === id)?.name ?? id} />}
      {mode === "accounts" && <Accounts view={view} setView={setView} onPractice={() => undefined} />}
    </main>
  );
}
