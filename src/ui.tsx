import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import logo from "./assets/logo.svg";
import { W } from "./words";

export const Logo = ({ className = "logo" }: { className?: string }) => <img className={className} src={logo} alt={W.app.name} />;

// 「隣り合う席」の印。隣席トレーナーの問いにだけ付ける
export const SeatMark = () => (
  <svg className="seat" viewBox="0 0 26 16" aria-hidden="true">
    <rect x="0" y="1" width="12" height="14" rx="3.5" fill="var(--c-primary)" />
    <rect x="14" y="1" width="12" height="14" rx="3.5" fill="var(--c-primary)" />
  </svg>
);

type Btn = ButtonHTMLAttributes<HTMLButtonElement> & { ghost?: boolean; small?: boolean };
export const Button = ({ ghost, small, className = "", ...rest }: Btn) => (
  <button type="button" {...rest} className={`btn ${ghost ? "btn-ghost" : ""} ${small ? "btn-small" : ""} ${className}`} />
);
export const LinkButton = (p: ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...p} className="link" />;

export const Title = ({ children, size = "h2", as: As = "h2" }: { children: ReactNode; size?: "big" | "h2" | "mid"; as?: "h1" | "h2" | "h3" }) => (
  <As className={`title ${size === "big" ? "title-big" : size === "mid" ? "title-mid" : ""}`}>{children}</As>
);
export const Sub = ({ children }: { children: ReactNode }) => <h3 className="sub">{children}</h3>;
export const Card = ({ children }: { children: ReactNode }) => <section className="card">{children}</section>;

// 商談日を押して選ぶ。今週から3週間分を出し、それより先は「別の日を選ぶ」で入れる
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const jpDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）`;
};
export function DatePick({ label, value, onChange }: { label: string; value: string; onChange: (iso: string) => void }) {
  const now = new Date();
  const today = isoDate(now);
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const days = Array.from({ length: 21 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
  return (
    <fieldset className="date-pick">
      <legend>{label}</legend>
      <div className="date-grid">
        {["月", "火", "水", "木", "金", "土", "日"].map((w) => <span key={w} className="date-head">{w}</span>)}
        {days.map((d, i) => {
          const iso = isoDate(d);
          const showMonth = i === 0 || d.getDate() === 1;
          return (
            <button
              key={iso} type="button" disabled={iso < today} aria-pressed={iso === value} aria-label={jpDate(iso)}
              className={`date-day ${iso === value ? "is-on" : ""} ${iso === today ? "is-today" : ""}`}
              onClick={() => onChange(iso)}
            >
              {showMonth && <small>{d.getMonth() + 1}月</small>}
              <span>{d.getDate()}</span>
            </button>
          );
        })}
      </div>
      <p className="date-chosen">{value ? <strong>{jpDate(value)}</strong> : W.entrance.dateEmpty}</p>
      <details className="date-other">
        <summary>{W.entrance.dateOther}</summary>
        <input type="date" aria-label={W.entrance.dateOther} value={value} min={today} onChange={(e) => onChange(e.target.value)} />
      </details>
    </fieldset>
  );
}

export const Approved = () => <span className="tag tag-ok">{W.tag.approved}</span>;
export const Pending = () => <span className="tag tag-wait">{W.tag.pending}</span>;
export const Tag = ({ kind, children }: { kind: "soft" | "step" | "line" | "wait" | "ok"; children: ReactNode }) => <span className={`tag tag-${kind}`}>{children}</span>;

export const Waiting = ({ children }: { children: ReactNode }) => <p className="waiting" role="status">{children}</p>;
export const Empty = ({ children }: { children: ReactNode }) => <p className="empty">{children}</p>;
export const Why = ({ children }: { children: ReactNode }) => <span className="why">{children}</span>;
export const Saved = ({ children }: { children: ReactNode }) => <p className="saved" role="status">{children}</p>;

// 赤一色にしない。印と文字で伝える
export const Notice = ({ children, plain }: { children: ReactNode; plain?: boolean }) => (
  <div className={`notice ${plain ? "notice-plain" : ""}`} role={plain ? undefined : "alert"}>
    <span className="notice-mark" aria-hidden="true">!</span>
    <div>{children}</div>
  </div>
);
export const ErrorNotice = ({ message }: { message: string | null }) => (message ? <Notice>{message}</Notice> : null);

export const Facts = ({ rows, two }: { rows: [string, ReactNode][]; two?: boolean }) => (
  <dl className={`facts ${two ? "facts-two" : ""}`} style={two ? ({ "--rows": Math.ceil(rows.length / 2) } as CSSProperties) : undefined}>
    {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
  </dl>
);

export const Band = ({ kind, left, action, right }: { kind: "self" | "boss"; left?: ReactNode; action?: ReactNode; right: ReactNode }) => (
  <div className={`band band-${kind}`}>
    <div className="band-in">
      {left && <span className="band-left">{left}</span>}
      {action}
      <span className="band-right">{right}</span>
    </div>
  </div>
);

// 隣席トレーナーの問いと書く欄。label で包むので、問いを押すと欄に入る
export const Ask = ({ question, value, onChange, rows = 6 }: { question: string; value: string; onChange: (v: string) => void; rows?: number }) => (
  <label className="ask">
    <span className="ask-who"><SeatMark />隣席トレーナー</span>
    <span className="ask-q">{question}</span>
    <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} />
  </label>
);

export type Turn = { role: "rep" | "buyer"; content: string };

export const Chat = ({ turns, buyerLabel, keyLine }: { turns: Turn[]; buyerLabel: string; keyLine?: string }) => (
  <ol className="chat">
    {turns.map((t, i) => (
      <li key={i} className={`say ${t.role === "rep" ? "say-rep" : ""}`}>
        <span className="say-who">{t.role === "rep" ? W.talk.you : buyerLabel}</span>
        <div className={`bubble ${t.role === "buyer" && t.content === keyLine ? "bubble-key" : ""}`}>{t.content}</div>
      </li>
    ))}
  </ol>
);

export type ConsultBody = { goal?: string; occasion?: string; summary: string; gainAnswer: string; returns: string[]; concessions: string[]; landing: string; asks: string[] };

export type Reply = { verdict: "go" | "condition" | "rethink"; comment: string; repliedAt: string; stale?: boolean };

// 上司の返事。判断と一言だけ
export const ReplyNote = ({ r }: { r: Reply }) => (
  <div className="box">
    <div className="row"><Tag kind={r.verdict === "rethink" ? "wait" : "ok"}>{W.reply.verdicts[r.verdict]}</Tag></div>
    <p>{r.comment}</p>
  </div>
);

// 相談文の1枚。若手の画面と上司の画面で同じ形にする
export const ConsultSheet = ({ c }: { c: ConsultBody }) => (
  <dl className="sheet">
    {c.goal && <div><dt>{W.consult.goal}</dt><dd>{c.occasion && `${c.occasion}：`}{c.goal}</dd></div>}
    <div><dt>{W.consult.summary}</dt><dd>{c.summary}</dd></div>
    <div><dt>{W.consult.gain}</dt><dd>{c.gainAnswer}</dd></div>
    <div>
      <dt>{W.consult.returns}</dt>
      <dd>
        {c.returns.map((r, i) => (
          <div key={i} className="give">
            <span>{W.returns.item(i + 1)}：{r}</span>
            {c.concessions[i] && <Tag kind="step">{W.consult.give}：{c.concessions[i]}</Tag>}
          </div>
        ))}
      </dd>
    </div>
    <div><dt>{W.consult.landing}</dt><dd>{c.landing}</dd></div>
    <div><dt>{W.consult.asks}</dt><dd>{c.asks.map((a, i) => <span key={i}>{a}</span>)}</dd></div>
  </dl>
);

// 帯の日付は「11月12日（木）」の形
export const shortDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}月${d.getDate()}日（${"日月火水木金土"[d.getDay()]}）`;
};

export const personName = (displayName: string) => displayName.replace(/（架空）$/, "");
export const honor = (name: string) => (name.endsWith("さん") ? name : `${name}さん`);
