import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { call } from "./api";
import { InterestsPanel, PartnerSheet, PrepBrief } from "./Counterpart";
import { useMe } from "./me";
import { Approved, Ask, Band, Button, Card, Chat, ConsultSheet, DatePick, Empty, ErrorNotice, Facts, LinkButton, Notice, ReplyNote, Saved, Sub, Tag, Title, Waiting, Why, honor, personName, shortDate, type ConsultBody, type Reply, type Turn } from "./ui";
import { W } from "./words";

type BuyerOption = { id: string; name: string; role: string; account_name: string };
type PrepRow = { id: string; meeting_on: string; stage: string; buyer_name: string; account_name: string };
type Candidate = { id: string; name: string; maker: string; is_own: number; facings: number; weekly_units: number; yoy_pct: number };
type CardBody = {
  id: string; title: string; situation: string; hypothesis: string; evidence: string; proposal: string; constraints: string;
  result: string; nextJudgment: string; rejectedOptions: { option: string; reason: string }[]; author: string;
};
type Recap = {
  meeting: { held_on: string; kind: string; summary: string } | null;
  promises: { text: string; due: string }[];
  results: { initiative: string; result: string; outcome: string; held_on: string }[];
  askCause: boolean;
};
type Prep = {
  consult: ConsultBody | null;
  reply: Reply | null;
  id: string; sessionId: string; buyerId: string; buyerName: string; accountName: string; accountId: string; accountSite: string; meetingOn: string; submittedAt: string;
  goal: string; occasionId: string; occasionName: string;
  gainAnswer: string; causeHypothesis: string; returns: string[]; landing: string; stage: string; turns: Turn[];
};

// 段階の番号。画面には名前だけを出す（W.steps.names）
const S = { entrance: 0, goal: 1, recap: 2, brief: 3, gain: 4, talk: 5, judgment: 6, returns: 7, again: 8, consult: 9 } as const;
const STEP_COUNT = W.steps.names.length;
const KEY_LINE = "どれを外すの？";

const fromHash = () => {
  const m = window.location.hash.match(/^#prep=([^&]+)(?:&step=(\d))?$/);
  return { id: m?.[1] ?? null, step: m?.[2] ? Number(m[2]) : null };
};

// 判断をもう見たか。返しを書き始めていれば見たことになる
const judged = (p: Prep) => p.stage !== "opening" && (p.stage !== "asked" || p.returns.length > 0 || p.landing !== "");
const prepared = (p: Prep) => p.returns.length >= 2 && p.landing !== "";

// その段階を開けるか。条件は依頼書の「次へ進む条件」
function canOpen(step: number, p: Prep, seen: boolean) {
  if (step <= S.goal) return true;
  if (!p.goal) return false;
  if (step <= S.gain) return true;
  if (!p.gainAnswer) return false;
  if (step === S.talk) return true;
  if (p.stage === "opening") return false;
  if (step === S.judgment) return true;
  if (step === S.returns) return seen || judged(p);
  return prepared(p);
}

// 続きから開くときの段階
function furthest(p: Prep) {
  if (!p.goal) return S.goal;
  const moved = ["retry", "refused", "agreed", "ended"].includes(p.stage);
  if (prepared(p) && p.consult) return S.consult;
  if (prepared(p) && moved) return S.again;
  if (p.gainAnswer && p.stage !== "opening" && (p.returns.length > 0 || p.landing !== "")) return S.returns;
  if (p.gainAnswer && moved) return S.judgment; // 返しが無いまま閉じた回は、判断から
  if (p.gainAnswer) return S.talk;
  return S.recap;
}

// ロゴと同じ線に目盛りを9つ。現在地の印と名前だけを出す。押せない
function StepLine({ step }: { step: number }) {
  const pos = (i: number) => `${(i / (STEP_COUNT - 1)) * 100}%`;
  const shift = step === 0 ? 0 : step === STEP_COUNT - 1 ? 100 : 50; // 両端は線の外へ出さない
  return (
    <div className="line-wrap">
      <div className="line-in">
        <div className="line">
          <div className="line-bar" />
          {W.steps.names.map((_, i) => <div key={i} className="line-tick" style={{ left: pos(i) }} />)}
          <div className="line-now" style={{ left: pos(step) }} />
          <div className="line-name" style={{ left: pos(step), transform: `translateX(-${shift}%)` }}>{W.steps.names[step]}</div>
        </div>
      </div>
    </div>
  );
}

// 商談前の準備室。再読み込みしても続きから開けるよう、準備の id と段階を URL に持つ
export function PrepRoom({ onReview }: { onReview: (sessionId: string, turns: Turn[], buyerName: string) => void }) {
  const me = useMe();
  const [prep, setPrep] = useState<Prep | null>(null);
  const [step, setStep] = useState<number>(S.entrance);
  const [seen, setSeen] = useState(false);
  const [info, setInfo] = useState(false); // 相手の情報。段階の画面はそのまま残すので、書きかけは消えない
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !!fromHash().id);

  // 段階では履歴を積まない（ブラウザの戻るで URL だけが変わらないように）
  const go = useCallback((p: Prep, n: number) => {
    window.history.replaceState(null, "", `#prep=${p.id}&step=${n}`);
    setStep(n);
    setError(null);
    window.scrollTo(0, 0);
  }, []);

  const open = useCallback((p: Prep) => {
    setPrep(p);
    setSeen(false);
    go(p, furthest(p));
  }, [go]);

  useEffect(() => {
    const { id, step: wanted } = fromHash();
    if (!id) return;
    call<Prep>(`/api/preps/${id}`).then((p) => {
      setPrep(p);
      const n = wanted !== null && wanted >= S.goal && wanted < STEP_COUNT && canOpen(wanted, p, false) ? wanted : furthest(p);
      setStep(n);
    }).catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  const self = W.band.self(honor(personName(me.displayName)));
  if (!prep && loading) return <Band kind="self" right={self} />;
  if (!prep) {
    return (
      <>
        <Band kind="self" left={W.band.noPartner} right={self} />
        <StepLine step={S.entrance} />
        <main className="page">
          <ErrorNotice message={error} />
          <Entrance onOpen={open} onError={setError} />
        </main>
      </>
    );
  }

  const nav: Nav = { prep, onChange: setPrep, onError: setError, go: (n) => go(prep, n) };
  const spoke = prep.turns.some((t) => t.role === "rep");
  return (
    <>
      <Band
        kind="self"
        left={`${personName(prep.accountName)} ${honor(personName(prep.buyerName))}｜${W.band.next} ${shortDate(prep.meetingOn)}`}
        action={<button type="button" className="band-btn" aria-haspopup="dialog" onClick={() => setInfo(true)}>{W.partner.open}</button>}
        right={self}
      />
      <StepLine step={step} />
      <main className="page">
        <ErrorNotice message={error} />
        {step !== S.goal && prep.goal && (
          <p className="goal-line"><strong>{W.goal.line}</strong>{prep.occasionName && `（${prep.occasionName}）`}{prep.goal}</p>
        )}
        {step === S.goal && <GoalStep {...nav} />}
        {step === S.recap && <RecapStep {...nav} />}
        {step === S.brief && <BriefStep {...nav} />}
        {step === S.gain && <GainStep {...nav} />}
        {step === S.talk && <TalkStep {...nav} onJudge={() => { setSeen(true); nav.go(S.judgment); }} />}
        {step === S.judgment && <JudgmentStep {...nav} auto={seen || judged(prep)} onSeen={() => setSeen(true)} />}
        {step === S.returns && <ReturnsStep {...nav} />}
        {step === S.again && <AgainStep {...nav} />}
        {step === S.consult && <ConsultStep {...nav} />}
        <div className="step-sub">
          <LinkButton onClick={() => { window.location.hash = ""; setPrep(null); setStep(S.entrance); setError(null); }}>{W.steps.other}</LinkButton>
          {spoke && [S.talk, S.again, S.consult].includes(step as 5 | 8 | 9) && (
            <LinkButton onClick={() => onReview(prep.sessionId, prep.turns, prep.buyerName)}>{W.steps.review}</LinkButton>
          )}
        </div>
      </main>
      {info && <PartnerSheet prepId={prep.id} name={`${personName(prep.accountName)} ${honor(personName(prep.buyerName))}`} onClose={() => setInfo(false)} />}
    </>
  );
}

function Entrance({ onOpen, onError }: { onOpen: (p: Prep) => void; onError: (m: string | null) => void }) {
  const [buyers, setBuyers] = useState<BuyerOption[]>([]);
  const [recent, setRecent] = useState<{ row: PrepRow; step: number; prep: Prep }[] | null>(null);
  const [buyerId, setBuyerId] = useState("");
  const [meetingOn, setMeetingOn] = useState("");

  useEffect(() => {
    call<BuyerOption[]>("/api/preps/buyers").then((b) => { setBuyers(b); setBuyerId(b[0]?.id ?? ""); }).catch((e: Error) => onError(e.message));
    call<PrepRow[]>("/api/preps")
      .then((rows) => Promise.all(rows.map(async (row) => {
        const prep = await call<Prep>(`/api/preps/${row.id}`);
        return { row, prep, step: furthest(prep) };
      })))
      .then(setRecent)
      .catch((e: Error) => onError(e.message));
  }, [onError]);

  const start = () => call<Prep>("/api/preps", "POST", { buyerId, meetingOn }).then(onOpen).catch((e: Error) => onError(e.message));
  const ready = !!buyerId && !!meetingOn;

  return (
    <>
      <Card>
        <Title size="big" as="h1">{W.entrance.title}</Title>
        <p className="lead">{W.entrance.lead}</p>
        <div className="entrance-form">
          <label className="field">
            {W.entrance.partner}
            <select value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
              {buyers.map((b) => <option key={b.id} value={b.id}>{personName(b.account_name)} {honor(personName(b.name))}</option>)}
            </select>
          </label>
          <DatePick label={W.entrance.date} value={meetingOn} onChange={setMeetingOn} />
          <Button onClick={start} disabled={!ready}>{W.entrance.start}</Button>
        </div>
        {!ready && <Why>{W.entrance.why}</Why>}
      </Card>
      <Card>
        <Title>{W.entrance.recent}</Title>
        {recent?.length === 0 && <Empty>{W.entrance.noRecent}</Empty>}
        <div className="grid-3">
          {recent?.map(({ row, step, prep }) => (
            <button key={row.id} type="button" className="pick" onClick={() => onOpen(prep)}>
              <span className="muted">{row.meeting_on}</span>
              <span className="pick-name">{personName(row.account_name)} {honor(personName(row.buyer_name))}</span>
              <Tag kind="step">{W.steps.names[step]}</Tag>
              {prep.reply && !prep.reply.stale && <Tag kind="ok">{W.reply.tag}</Tag>}
            </button>
          ))}
        </div>
      </Card>
    </>
  );
}

type Nav = { prep: Prep; onChange: (p: Prep) => void; onError: (m: string | null) => void; go: (n: number) => void };

// 下の段：戻る／次へ。次へ進めないときは理由を横に書く
function StepNav({ back, children }: { back?: () => void; children: ReactNode }) {
  return (
    <div className="step-nav">
      {back ? <Button ghost onClick={back}>{W.steps.back}</Button> : <span />}
      <div className="step-nav-right">{children}</div>
    </div>
  );
}

// 今回の目的：機会はコードが締切で絞り、何のために会うかは本人が書く（Claude は使わない）
type Occasion = { id: string; name: string; store_action: string; deadline_on: string };
function GoalStep({ prep, onChange, onError, go }: Nav) {
  const [occasions, setOccasions] = useState<Occasion[] | null>(null);
  const [pick, setPick] = useState(prep.occasionId);
  const [goal, setGoal] = useState(prep.goal);
  useEffect(() => {
    call<{ events: Occasion[] }>(`/api/preps/${prep.id}/brief`).then((b) => setOccasions(b.events)).catch((e: Error) => onError(e.message));
  }, [prep.id, onError]);
  const picked = occasions?.find((o) => o.id === pick);
  const ready = !!goal.trim() && (!!picked || occasions?.length === 0);
  const next = () => call<Prep>(`/api/preps/${prep.id}`, "PATCH", { goal, occasionId: picked?.id ?? "" })
    .then((p) => { onChange(p); go(S.recap); }).catch((e: Error) => onError(e.message));
  return (
    <>
      <Card>
        <Title size="big" as="h1">{W.steps.names[S.goal]}</Title>
        <p className="lead">{W.goal.lead}</p>
        <Sub>{W.goal.pick}</Sub>
        {!occasions && <Waiting>{W.state.reading}</Waiting>}
        {occasions?.length === 0 && <Empty>{W.goal.none}</Empty>}
        <div className="grid-3">
          {occasions?.map((o) => (
            <button key={o.id} type="button" className={`pick${o.id === pick ? " pick-on" : ""}`} aria-pressed={o.id === pick} onClick={() => setPick(o.id)}>
              <span className="pick-name">{o.name}</span>
              <span className="muted">{W.goal.deadline(o.deadline_on)}</span>
              <span>{o.store_action}</span>
            </button>
          ))}
        </div>
        {picked && !picked.store_action.includes("棚割り") && <Why>{W.goal.notShelf}</Why>}
      </Card>
      <Card>
        <Ask question={W.goal.ask} value={goal} onChange={setGoal} rows={3} />
      </Card>
      <StepNav>
        {!ready && <Why>{W.goal.why}</Why>}
        <Button onClick={next} disabled={!ready}>{W.steps.next}</Button>
      </StepNav>
    </>
  );
}

// 前回の続き：人が確定した記録だけを読む
function RecapStep({ prep, onChange, onError, go }: Nav) {
  const [data, setData] = useState<Recap | null>(null);
  const [failed, setFailed] = useState(false);
  const [cause, setCause] = useState(prep.causeHypothesis);
  useEffect(() => {
    call<Recap>(`/api/preps/${prep.id}/recap`).then(setData).catch((e: Error) => { setFailed(true); onError(e.message); });
  }, [prep.id, onError]);
  const save = () => call<Prep>(`/api/preps/${prep.id}`, "PATCH", { causeHypothesis: cause }).then(onChange);
  // 書き留めずに進んでも、書いた文字を消さない
  const next = () => (cause.trim() && cause.trim() !== prep.causeHypothesis ? save() : Promise.resolve()).then(() => go(S.brief)).catch((e: Error) => onError(e.message));
  const nextNav = <StepNav back={() => go(S.goal)}><Button onClick={next}>{W.steps.next}</Button></StepNav>;
  if (failed) return nextNav;
  if (!data) return <Waiting>{W.state.reading}</Waiting>;
  return (
    <>
      <Card>
        <Title size="big" as="h1">{W.steps.names[S.recap]}</Title>
        {!data.meeting && <Empty>{W.state.noRecord}</Empty>}
        {data.meeting && (
          <div className="stack">
            <Sub>{W.recap.last}</Sub>
            <p className="muted">{data.meeting.held_on} {data.meeting.kind}</p>
            <p>{data.meeting.summary}</p>
          </div>
        )}
        {data.promises.length > 0 && (
          <div className="stack">
            <Sub>{W.recap.promises}</Sub>
            {data.promises.map((p, i) => <p key={i}>{p.text}{p.due && `（${p.due}まで）`}</p>)}
          </div>
        )}
        {data.results.length > 0 && (
          <div className="stack">
            <Sub>{W.recap.results}</Sub>
            {data.results.map((r, i) => (
              <div key={i} className="box">
                <div className="row"><strong>{r.initiative}</strong>{r.outcome === "bad" && <Tag kind="wait">{W.recap.bad}</Tag>}</div>
                <p>{r.result}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
      {data.askCause && (
        <Card>
          <Ask question={W.recap.ask} value={cause} onChange={setCause} />
          <div className="row">
            <Button onClick={() => save().catch((e: Error) => onError(e.message))} disabled={!cause.trim() || cause.trim() === prep.causeHypothesis}>{W.recap.save}</Button>
            {!!prep.causeHypothesis && cause.trim() === prep.causeHypothesis && <Why>{W.recap.saved}</Why>}
          </div>
        </Card>
      )}
      {nextNav}
    </>
  );
}

function BriefStep({ prep, onError, go }: Nav) {
  const [used, setUsed] = useState(0); // 「使う」を押したら、下調べを読み直す
  return (
    <>
      <div className="stack">
        <Title size="big" as="h1">{W.steps.names[S.brief]}</Title>
        <p className="lead">{W.brief.lead}</p>
      </div>
      <PrepBrief prepId={prep.id} written={[prep.gainAnswer, ...prep.returns, prep.landing, used].join("\n")} onError={onError} />
      <Card><InterestsPanel accountId={prep.accountId} siteUrl={prep.accountSite} onError={onError} onChange={() => setUsed((n) => n + 1)} reading /></Card>
      <StepNav back={() => go(S.recap)}><Button onClick={() => go(S.gain)}>{W.steps.next}</Button></StepNav>
    </>
  );
}

// 得意先の得：Claude は使わない固定の問い
function GainStep({ prep, onChange, onError, go }: Nav) {
  const [answer, setAnswer] = useState(prep.gainAnswer);
  // 書き留めずに移っても、書いた文字を消さない
  const leave = (to: number) => {
    if (!answer.trim() || answer.trim() === prep.gainAnswer) return go(to);
    call<Prep>(`/api/preps/${prep.id}`, "PATCH", { gainAnswer: answer }).then((p) => { onChange(p); go(to); }).catch((e: Error) => onError(e.message));
  };
  const save = () => leave(S.talk);
  return (
    <>
      <Card>
        <Ask question={W.gain.ask} value={answer} onChange={setAnswer} />
        <div><Button onClick={save} disabled={!answer.trim() || answer.trim() === prep.gainAnswer}>{W.gain.save}</Button></div>
      </Card>
      <StepNav back={() => leave(S.brief)}>
        {!prep.gainAnswer && <Why>{W.gain.why}</Why>}
        <Button ghost onClick={() => leave(S.talk)} disabled={!prep.gainAnswer}>{W.steps.next}</Button>
      </StepNav>
    </>
  );
}

const flowIndex = (stage: string) => ({ opening: 0, asked: 1, retry: 1, refused: 2, agreed: 3, ended: 3 } as Record<string, number>)[stage] ?? 0;

// 止まる練習と答え直しの共通の画面：左に会話、右に会話の流れ
function Conversation({ prep, onChange, onError, guide, canSay, keyLine, children }: Nav & { guide: string; canSay: boolean; keyLine?: string; children?: ReactNode }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const buyer = honor(personName(prep.buyerName));
  const count = prep.turns.length;
  useEffect(() => { if (count > 2) end.current?.scrollIntoView({ block: "nearest" }); }, [count]);
  const send = async () => {
    setBusy(true);
    onError(null);
    try {
      const r = await call<{ prep: Prep }>(`/api/preps/${prep.id}/turn`, "POST", { text: draft });
      onChange(r.prep);
      setDraft("");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const now = flowIndex(prep.stage);
  return (
    <div className="talk">
      <section className="card">
        <Title size="mid" as="h1">{guide}</Title>
        <Chat turns={prep.turns} buyerLabel={W.talk.buyerRole(personName(prep.buyerName))} keyLine={keyLine} />
        {prep.stage === "agreed" && <p className="arrived" role="status">{W.talk.agreed}</p>}
        {prep.stage === "ended" && <Notice>{W.talk.ended}</Notice>}
        {canSay && (
          <>
            <div className="say-input">
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder={W.talk.placeholder} aria-label={W.talk.placeholder} />
              <Button onClick={send} disabled={busy || !draft.trim()}>{W.talk.say}</Button>
            </div>
            {busy && <Waiting>{W.state.thinking}</Waiting>}
          </>
        )}
        <div ref={end} />
        {children}
      </section>
      <aside className="card">
        <Sub>{W.talk.flowTitle}</Sub>
        <ol className="flow">
          {W.talk.flow.map((name, i) => <li key={name} aria-current={i === now ? "step" : undefined}>{name}</li>)}
        </ol>
        {canSay && (prep.stage === "asked" || prep.stage === "refused") && <p className="small">{W.talk.hint(buyer)}</p>}
      </aside>
    </div>
  );
}

function TalkStep(p: Nav & { onJudge: () => void }) {
  const { prep, go, onJudge } = p;
  const buyer = honor(personName(prep.buyerName));
  const canSay = prep.stage === "opening" || prep.stage === "asked";
  return (
    <>
      <Conversation {...p} guide={canSay ? W.talk.guide(buyer) : W.steps.names[S.talk]} canSay={canSay} keyLine={KEY_LINE} />
      <StepNav back={() => go(S.gain)}>
        {prep.stage === "opening" && <Why>{W.talk.judgmentWhy}</Why>}
        <Button onClick={onJudge} disabled={prep.stage === "opening"}>{W.talk.toJudgment}</Button>
      </StepNav>
    </>
  );
}

const CARD_SECTIONS = ["situation", "hypothesis", "evidence", "proposal", "constraints", "result", "nextJudgment"] as const;

// ベテランの判断：若手が問いを受けて答えた後に見る。出すかどうかはサーバーが決める
function JudgmentStep({ prep, onError, go, auto, onSeen }: Nav & { auto: boolean; onSeen: () => void }) {
  const [data, setData] = useState<{ candidates: Candidate[]; card: CardBody | null; moreCards: CardBody[] } | null>(null);
  const ran = useRef(false);
  const show = useCallback(() => {
    ran.current = true;
    return call<{ candidates: Candidate[]; card: CardBody | null; moreCards: CardBody[] }>(`/api/preps/${prep.id}/judgment`).then((d) => { setData(d); onSeen(); }).catch((e: Error) => onError(e.message));
  }, [prep.id, onError, onSeen]);
  useEffect(() => {
    if (auto && !ran.current) void show();
  }, [auto, show]);

  if (!data) {
    return (
      <>
        <Card>
          <Title size="big" as="h1">{W.steps.names[S.judgment]}</Title>
          <div><Button onClick={show}>{W.talk.toJudgment}</Button></div>
        </Card>
        <StepNav back={() => go(S.talk)}><span /></StepNav>
      </>
    );
  }
  return (
    <>
      <Card>
        <Title size="big" as="h1">{W.steps.names[S.judgment]}</Title>
        <Sub>{W.judgment.shelf}</Sub>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>{W.judgment.cols.map((h, i) => <th key={h} className={i >= 2 ? "num" : undefined}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {data.candidates.map((c) => (
                <tr key={c.id} className={c.is_own ? "own" : undefined}>
                  <td>{c.name} {!!c.is_own && <Tag kind="step">{W.tag.own}</Tag>}</td>
                  <td>{c.maker}</td>
                  <td className="num">{c.facings}</td>
                  <td className="num">{c.weekly_units}本</td>
                  <td className="num">{c.yoy_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <Title size="mid">{W.judgment.card}</Title>
        {!data.card && <Empty>{W.judgment.noCard}</Empty>}
        {data.card && (
          <div className="stack">
            <div className="row"><Approved /><Sub>{data.card.title}</Sub></div>
            <dl className="sheet">
              {CARD_SECTIONS.map((k) => <div key={k}><dt>{W.judgment.sections[k]}</dt><dd className="pre">{data.card![k]}</dd></div>)}
            </dl>
            {data.card.rejectedOptions.length > 0 && (
              <div className="stack">
                <strong>{W.judgment.rejected}</strong>
                {data.card.rejectedOptions.map((r) => <p key={r.option}>{r.option}：{r.reason}</p>)}
              </div>
            )}
            <small>{data.card.author}</small>
          </div>
        )}
      </Card>
      {data.moreCards.length > 0 && (
        <Card>
          <Title size="mid">{W.judgment.more}</Title>
          {data.moreCards.map((m) => (
            <div key={m.id} className="box">
              <div className="row"><Approved /><strong>{m.title}</strong></div>
              <Facts rows={[[W.judgment.proposal, <span className="pre">{m.proposal}</span>]]} />
              <small>{m.author}</small>
            </div>
          ))}
        </Card>
      )}
      <StepNav back={() => go(S.talk)}><Button onClick={() => go(S.returns)}>{W.steps.next}</Button></StepNav>
    </>
  );
}

// 返しを用意して答え直す。新しい商談は作らず、同じ商談の続きに戻る
function ReturnsStep({ prep, onChange, onError, go }: Nav) {
  const [returns, setReturns] = useState([0, 1, 2].map((i) => prep.returns[i] ?? ""));
  const [landing, setLanding] = useState(prep.landing);
  const ready = returns.filter((r) => r.trim()).length >= 2 && landing.trim() !== "";
  // 欄を離れたら書いた分を残す（揃っていなくても消えない）
  const save = () => call<Prep>(`/api/preps/${prep.id}`, "PATCH", { returns, landing }).then(onChange).catch((e: Error) => onError(e.message));
  const retry = async () => {
    try {
      await call(`/api/preps/${prep.id}`, "PATCH", { returns, landing });
      onChange(await call<Prep>(`/api/preps/${prep.id}/retry`, "POST"));
      go(S.again);
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const moved = ["retry", "refused", "agreed", "ended"].includes(prep.stage);
  return (
    <>
      <Card>
        <Title size="big" as="h1">{W.steps.names[S.returns]}</Title>
        <p className="lead">{W.returns.lead}</p>
        {returns.map((r, i) => (
          <label key={i} className="field">
            <span>{W.returns.item(i + 1)}{i === 2 && <small>{W.returns.optional}</small>}</span>
            <textarea value={r} onChange={(e) => setReturns(returns.map((x, j) => (j === i ? e.target.value : x)))} onBlur={save} rows={2} />
          </label>
        ))}
        <label className="field">
          {W.returns.landing}
          <textarea value={landing} onChange={(e) => setLanding(e.target.value)} onBlur={save} rows={2} />
        </label>
      </Card>
      <StepNav back={() => go(S.judgment)}>
        {!ready && <Why>{W.returns.why}</Why>}
        {moved && prepared(prep) && <Button ghost onClick={() => go(S.again)}>{W.steps.next}</Button>}
        <Button onClick={retry} disabled={!ready}>{W.returns.retry}</Button>
      </StepNav>
    </>
  );
}

function AgainStep(p: Nav) {
  const { prep, go, onChange, onError } = p;
  const talking = prep.stage === "retry" || prep.stage === "refused";
  const retry = () => call<Prep>(`/api/preps/${prep.id}/retry`, "POST").then(onChange).catch((e: Error) => onError(e.message));
  return (
    <>
      <Conversation {...p} guide={W.talk.againGuide} canSay={talking}>
        {(prep.stage === "asked" || prep.stage === "ended") && prepared(prep) && <div><Button onClick={retry}>{W.returns.retry}</Button></div>}
      </Conversation>
      <StepNav back={() => go(S.returns)}>
        {prep.stage === "ended" && <Button ghost onClick={() => go(S.returns)}>{W.talk.rework}</Button>}
        <Button onClick={() => go(S.consult)} disabled={!prepared(prep)}>{W.steps.next}</Button>
      </StepNav>
    </>
  );
}

// 上司への相談文。上司が返事する画面は作らない。若手が持っていく1枚
function ConsultStep({ prep, onChange, onError, go }: Nav) {
  const [busy, setBusy] = useState(false);
  const run = async (path: string) => {
    setBusy(true);
    onError(null);
    try {
      onChange(await call<Prep>(path, "POST"));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const make = () => run(`/api/preps/${prep.id}/consult`);
  const send = () => run(`/api/preps/${prep.id}/consult/send`);
  const c = prep.consult;
  return (
    <>
      <Card>
        <div className="head-row">
          <div className="stack">
            <Title size="big" as="h1">{W.steps.names[S.consult]}</Title>
            <p className="lead">{W.consult.lead}</p>
          </div>
          <div className="row">
            <Button ghost={!!c} onClick={make} disabled={busy}>{c ? W.consult.remake : W.consult.make}</Button>
            {c && !prep.submittedAt && <Button onClick={send} disabled={busy}>{W.consult.send}</Button>}
          </div>
        </div>
        {busy && <Waiting>{W.state.writing}</Waiting>}
        {c && !prep.submittedAt && <Notice plain>{W.consult.onlyThis}</Notice>}
        {c && prep.submittedAt && <Saved>{W.consult.sent}</Saved>}
      </Card>
      {prep.reply && (
        <Card>
          <Title>{prep.reply.stale ? W.reply.old : W.reply.from}</Title>
          <ReplyNote r={prep.reply} />
        </Card>
      )}
      {c && (
        <Card>
          <Title>{W.consult.sheet}</Title>
          <p className="muted">{W.consult.title(personName(prep.accountName), honor(personName(prep.buyerName)), prep.meetingOn)}</p>
          <ConsultSheet c={c} />
        </Card>
      )}
      <StepNav back={() => go(S.again)}><span /></StepNav>
    </>
  );
}
