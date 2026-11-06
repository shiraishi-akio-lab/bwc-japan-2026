import { useEffect, useState, type ReactNode } from "react";
import { call } from "./api";
import { useMe } from "./me";
import type { View } from "./Accounts";
import { Button, Card, LinkButton, Notice, Title, Waiting } from "./ui";
import { W } from "./words";

type Label = { type: "meeting" | "priority" | "promise"; id: string };
type Evaluation = { iteration: number; result: string; explanation: string };
export type HandoffRow = { id: string; from_rep: string; to_rep: string; status: string; created_at: string };
type Handoff = HandoffRow & {
  account_id: string; content: string; labels: Record<string, Label>; evaluations: Evaluation[];
  unknownLabels: string[]; grading: boolean; buyers: { id: string; name: string }[];
};

const POLL_MS = 5000;

// 本文の [M1] を、議事録へのリンクにする
function Inline({ text, labels, setView }: { text: string; labels: Record<string, Label>; setView: (v: View) => void }) {
  const parts = text.split(/(\[[MPT]\d+\]|\*\*[^*]+\*\*)/);
  return (
    <>
      {parts.map((p, i) => {
        const bold = p.match(/^\*\*(.+)\*\*$/);
        if (bold) return <strong key={i}>{bold[1]}</strong>;
        const label = p.match(/^\[([MPT]\d+)\]$/)?.[1];
        if (!label) return p;
        const target = labels[label];
        if (target?.type === "meeting") return <LinkButton key={i} onClick={() => setView({ name: "meeting", id: target.id })}>{p}</LinkButton>;
        return <small key={i}>{p}</small>;
      })}
    </>
  );
}

// 見出し・箇条書き・表だけの Markdown を読む
function Document({ content, labels, setView }: { content: string; labels: Record<string, Label>; setView: (v: View) => void }) {
  const inline = (t: string) => <Inline text={t} labels={labels} setView={setView} />;
  const out: ReactNode[] = [];
  const rows = content.split("\n");
  for (let i = 0; i < rows.length; i++) {
    const l = rows[i].trim();
    if (!l) continue;
    if (l.startsWith("|")) {
      const table: string[][] = [];
      for (; i < rows.length && rows[i].trim().startsWith("|"); i++) {
        const cells = rows[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) table.push(cells);
      }
      i--;
      out.push(
        <div key={i} className="scroll-x">
          <table>
            <tbody>
              {table.map((r, ri) => (
                <tr key={ri}>{r.map((c, ci) => <td key={ci} style={{ fontWeight: ri === 0 ? 800 : 400 }}>{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (l.startsWith("# ")) out.push(<h3 key={i} className="sub">{inline(l.slice(2))}</h3>);
    else if (l.startsWith("## ")) out.push(<h4 key={i}>{inline(l.slice(3))}</h4>);
    else if (l.startsWith("### ")) out.push(<h4 key={i}>{inline(l.slice(4))}</h4>);
    else if (/^([-*]|\d+\.)\s/.test(l)) out.push(<div key={i} style={{ marginLeft: 12 }}>{l.startsWith("-") || l.startsWith("*") ? "・" : `${l.match(/^\d+/)?.[0]}. `}{inline(l.replace(/^([-*]|\d+\.)\s/, ""))}</div>);
    else out.push(<p key={i}>{inline(l)}</p>);
  }
  return <>{out}</>;
}

export function HandoffPage({ id, setView, onError, onPractice }: { id: string; setView: (v: View) => void; onError: (m: string | null) => void; onPractice: (buyerId: string) => void }) {
  const isManager = useMe().role === "manager";
  const [h, setH] = useState<Handoff | null>(null);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const d = await call<Handoff>(`/api/handoffs/${id}`);
        if (stop) return;
        setH(d);
        if (d.status === "running") timer = setTimeout(tick, POLL_MS);
      } catch (e) {
        onError((e as Error).message);
      }
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [id, onError]);
  if (!h) return null;
  const round = h.evaluations.length + 1;
  return (
    <>
      <Card>
        <Title size="big" as="h1">{W.handoff.title(h.from_rep, h.to_rep)}</Title>
        <p className="lead">{W.handoff.lead}</p>
        <div><LinkButton onClick={() => setView({ name: "account", id: h.account_id })}>{W.accounts.backAccount}</LinkButton></div>
      </Card>
      <Card>
        <Title size="mid">{W.handoff.log}</Title>
        {h.evaluations.map((e) => (
          <details key={e.iteration} className="box" open={e.result === "needs_revision"}>
            <summary>{W.handoff.round(e.iteration + 1, e.result)}</summary>
            <div className="pre small">{e.explanation}</div>
          </details>
        ))}
        {h.status === "running" && <Waiting>{h.grading ? W.handoff.checking(round) : W.handoff.writing(round)}</Waiting>}
        {h.status === "failed" && <Notice>{W.handoff.failed}</Notice>}
        {h.status === "unpassed" && <Notice>{W.handoff.unpassed}</Notice>}
        {h.unknownLabels.length > 0 && <Notice>{W.handoff.unknown(h.unknownLabels.join("、"))}</Notice>}
      </Card>
      {h.content && (
        <Card>
          <Document content={h.content} labels={h.labels} setView={setView} />
          <div className="row">
            {!isManager && h.buyers.map((b) => <Button key={b.id} onClick={() => onPractice(b.id)}>{W.handoff.practice(b.name)}</Button>)}
          </div>
        </Card>
      )}
    </>
  );
}

export function HandoffStart({ accountId, ownerRep, setView, onError }: { accountId: string; ownerRep: string; setView: (v: View) => void; onError: (m: string | null) => void }) {
  const [toRep, setToRep] = useState("");
  const [rows, setRows] = useState<HandoffRow[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    call<HandoffRow[]>(`/api/accounts/${accountId}/handoffs`).then(setRows).catch((e: Error) => onError(e.message));
  }, [accountId, onError]);
  const start = async () => {
    setBusy(true);
    try {
      const r = await call<{ id: string }>(`/api/accounts/${accountId}/handoffs`, "POST", { toRep });
      setView({ name: "handoff", id: r.id });
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <>
      <Title size="mid">{W.handoff.start}</Title>
      <p className="muted">{W.handoff.startLead(ownerRep)}</p>
      <div className="row-end">
        <label className="field">{W.handoff.to}<input value={toRep} onChange={(e) => setToRep(e.target.value)} maxLength={40} /></label>
        <Button onClick={start} disabled={busy || !toRep.trim()}>{W.handoff.make}</Button>
      </div>
      {rows.map((r) => (
        <button key={r.id} type="button" className="pick" onClick={() => setView({ name: "handoff", id: r.id })}>
          <strong>{r.from_rep} → {r.to_rep}</strong>
          <span className="small">{W.handoff.status[r.status]}・{r.created_at.slice(0, 10)}</span>
        </button>
      ))}
    </>
  );
}
