import { useCallback, useEffect, useState } from "react";
import { Accounts, type View } from "./Accounts";
import { call } from "./api";
import { InterestsPanel } from "./Counterpart";
import { Organize } from "./Organize";
import { Shell } from "./Shell";
import { Approved, Band, Button, Card, ConsultSheet, Empty, ErrorNotice, Facts, Pending, Sub, Title, honor, personName, type ConsultBody } from "./ui";
import { W } from "./words";

type Consult = ConsultBody & { id: string; repName: string; buyerName: string; accountName: string; meetingOn: string; submittedAt: string };
type DraftCard = { title: string; scene: string; appliesWhen: string; situation: string; hypothesis: string; evidence: string; proposal: string; constraints: string; result: string; nextJudgment: string };
type Draft = { id: string; createdAt: string; card: DraftCard };
type AccountRow = { id: string; name: string };
type AccountDetail = { account: { site_url: string } };
type Rubric = { id: string; name: string };
type OnError = (m: string | null) => void;

// 部下から届いた相談文。若手が「上司に出す」を押したものだけ。練習の中身はここに来ない
function Consults({ onError }: { onError: OnError }) {
  const [rows, setRows] = useState<Consult[] | null>(null);
  useEffect(() => {
    call<Consult[]>("/api/consults").then(setRows).catch((e: Error) => onError(e.message));
  }, [onError]);
  return (
    <>
      <Card>
        <Title size="big" as="h1">{W.manager.consults}</Title>
        <p className="lead">{W.manager.consultsLead}</p>
        {rows?.length === 0 && <Empty>{W.manager.noConsults}</Empty>}
      </Card>
      {rows?.map((c) => (
        <Card key={c.id}>
          <Title size="mid">{personName(c.repName)}：{W.consult.title(personName(c.accountName), honor(personName(c.buyerName)), c.meetingOn)}</Title>
          <ConsultSheet c={c} />
          <small>{W.manager.arrived(c.submittedAt)}</small>
        </Card>
      ))}
    </>
  );
}

const CARD_SECTIONS = ["scene", "appliesWhen", "situation", "hypothesis", "evidence", "proposal", "constraints", "result", "nextJudgment"] as const;

function CardCandidates({ onError }: { onError: OnError }) {
  const [rows, setRows] = useState<Draft[]>([]);
  // 承認した直後の札の変わり目を見せる。一覧の API は承認待ちだけを返すので、この画面の間だけ持つ
  const [done, setDone] = useState<Draft[]>([]);
  const load = useCallback(() => call<Draft[]>("/api/drafts").then(setRows).catch((e: Error) => onError(e.message)), [onError]);
  useEffect(() => { void load(); }, [load]);
  const judge = async (d: Draft, status: string) => {
    try {
      await call(`/api/drafts/${d.id}`, "POST", { status });
      if (status === "approved") setDone((x) => [d, ...x]);
      await load();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  return (
    <>
      <Title size="mid">{W.manager.cards}</Title>
      {rows.length === 0 && done.length === 0 && <Empty>{W.manager.noCards}</Empty>}
      {rows.map((d) => (
        <div key={d.id} className="box">
          <div className="row"><Pending /><Sub>{d.card.title}</Sub></div>
          <Facts two rows={CARD_SECTIONS.map((k) => [W.manager.sections[k], d.card[k]])} />
          <div className="row">
            <Button small onClick={() => judge(d, "approved")}>{W.manager.approve}</Button>
            <Button small ghost onClick={() => judge(d, "rejected")}>{W.manager.reject}</Button>
          </div>
        </div>
      ))}
      {done.map((d) => (
        <div key={d.id} className="box">
          <div className="row"><Approved /><strong>{d.card.title}</strong></div>
          <Facts rows={[[W.manager.sections.appliesWhen, d.card.appliesWhen]]} />
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
        <InterestsPanel key={a.id} accountId={a.id} siteUrl={a.siteUrl} onError={onError} title={`${W.manager.interests}（${personName(a.name)}）`} lead="" empty={W.manager.noCards} />
      ))}
    </>
  );
}

export function Manager({ onLogout }: { onLogout: () => void }) {
  const [mode, setMode] = useState<"consults" | "candidates" | "import" | "accounts">("consults");
  const [view, setView] = useState<View>({ name: "list" });
  const [axes, setAxes] = useState<Rubric[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    call<Rubric[]>("/api/rubric").then(setAxes).catch((e: Error) => setError(e.message));
  }, []);
  const go = (m: typeof mode) => {
    setError(null);
    if (m === "accounts") setView({ name: "list" });
    setMode(m);
  };
  const n = W.nav.manager;
  return (
    <Shell items={[["consults", n.consults], ["candidates", n.candidates], ["import", n.import], ["accounts", n.accounts]]} current={mode} onGo={go} onLogout={onLogout}>
      <Band kind="boss" right={W.band.boss} />
      <main className="page">
        <ErrorNotice message={error} />
        {mode === "consults" && <Consults onError={setError} />}
        {mode === "candidates" && (
          <Card>
            <Title size="big" as="h1">{W.manager.candidates}</Title>
            <p className="lead">{W.manager.candidatesLead}</p>
            <CardCandidates onError={setError} />
            <InterestCandidates onError={setError} />
          </Card>
        )}
        {mode === "import" && <Organize axisName={(id) => axes.find((a) => a.id === id)?.name ?? id} />}
        {mode === "accounts" && <Accounts view={view} setView={setView} onPractice={() => undefined} />}
      </main>
    </Shell>
  );
}
