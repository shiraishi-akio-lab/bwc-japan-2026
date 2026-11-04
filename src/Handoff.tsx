import { useEffect, useState, type ReactNode } from "react";
import { box, call, link, type View } from "./Accounts";

type Label = { type: "meeting" | "priority" | "promise"; id: string };
type Evaluation = { iteration: number; result: string; explanation: string };
export type HandoffRow = { id: string; from_rep: string; to_rep: string; status: string; created_at: string };
type Handoff = HandoffRow & {
  account_id: string; content: string; labels: Record<string, Label>; evaluations: Evaluation[];
  unknownLabels: string[]; grading: boolean; buyers: { id: string; name: string }[];
};

const POLL_MS = 5000;
export const STATUS: Record<string, string> = { running: "作成中", passed: "合格", unpassed: "基準に届かず", failed: "失敗" };

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
        if (target?.type === "meeting") return <button key={i} style={{ ...link, fontSize: 13 }} onClick={() => setView({ name: "meeting", id: target.id })}>{p}</button>;
        return <small key={i} style={{ color: "#555" }}>{p}</small>;
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
        <div key={i} style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {table.map((r, ri) => (
                <tr key={ri}>{r.map((c, ci) => <td key={ci} style={{ border: "1px solid #ddd", padding: 6, fontWeight: ri === 0 ? 600 : 400 }}>{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (l.startsWith("# ")) out.push(<h3 key={i}>{inline(l.slice(2))}</h3>);
    else if (l.startsWith("## ")) out.push(<h4 key={i} style={{ marginBottom: 4 }}>{inline(l.slice(3))}</h4>);
    else if (l.startsWith("### ")) out.push(<h5 key={i} style={{ marginBottom: 4 }}>{inline(l.slice(4))}</h5>);
    else if (/^([-*]|\d+\.)\s/.test(l)) out.push(<div key={i} style={{ margin: "4px 0 4px 12px" }}>{l.startsWith("-") || l.startsWith("*") ? "・" : `${l.match(/^\d+/)?.[0]}. `}{inline(l.replace(/^([-*]|\d+\.)\s/, ""))}</div>);
    else out.push(<p key={i} style={{ margin: "4px 0" }}>{inline(l)}</p>);
  }
  return <>{out}</>;
}

export function HandoffPage({ id, setView, onError, onPractice }: { id: string; setView: (v: View) => void; onError: (m: string | null) => void; onPractice: (buyerId: string) => void }) {
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
      <h2>引き継ぎ書：{h.from_rep} → {h.to_rep}</h2>
      <p style={{ color: "#555" }}>確定した議事録と承認済みの記録だけを読んで書きます。別の採点係が基準を見て、足りなければ差し戻します。</p>
      <button style={link} onClick={() => setView({ name: "account", id: h.account_id })}>取引先に戻る</button>
      <h3>採点の記録</h3>
      {h.evaluations.map((e) => (
        <details key={e.iteration} style={box} open={e.result === "needs_revision"}>
          <summary>{e.iteration + 1}回目：{e.result === "satisfied" ? "合格" : e.result === "needs_revision" ? "差し戻し" : e.result}</summary>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 14, marginTop: 8 }}>{e.explanation}</div>
        </details>
      ))}
      {h.status === "running" && <p role="status">{h.grading ? `${round}回目を採点しています…` : `${round}回目を書いています…`}（数分かかります）</p>}
      {h.status === "failed" && <p role="alert" style={{ color: "#b00020" }}>作成できませんでした。もう一度試してください。</p>}
      {h.status === "unpassed" && <p role="alert" style={{ color: "#b06000" }}>基準に届かないまま回数の上限になりました。読むときは差し戻しの理由を確かめてください。</p>}
      {h.unknownLabels.length > 0 && <p role="alert" style={{ color: "#b00020" }}>記録に無い根拠が書かれています：{h.unknownLabels.join("、")}</p>}
      {h.content && (
        <>
          <div style={box}><Document content={h.content} labels={h.labels} setView={setView} /></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {h.buyers.map((b) => <button key={b.id} onClick={() => onPractice(b.id)}>{b.name}さんを相手に練習する</button>)}
          </div>
        </>
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
      <h3>担当の引き継ぎ</h3>
      <p style={{ color: "#555", marginTop: 0 }}>{ownerRep}さんの記録から、後任の人に向けた引き継ぎ書を作ります。</p>
      <label>引き継ぐ人 <input value={toRep} onChange={(e) => setToRep(e.target.value)} maxLength={40} /></label>{" "}
      <button onClick={start} disabled={busy || !toRep.trim()}>引き継ぎ書を作る</button>
      {rows.map((r) => (
        <div key={r.id} style={box}>
          <button style={link} onClick={() => setView({ name: "handoff", id: r.id })}>{r.from_rep} → {r.to_rep}</button>
          <span style={{ marginLeft: 8, fontSize: 13, color: "#555" }}>{STATUS[r.status]}・{r.created_at.slice(0, 10)}</span>
        </div>
      ))}
    </>
  );
}
