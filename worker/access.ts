// API の棚卸し表。ここに無いルートは動かない（既定で拒否）。
// demo:check が worker/ のルート定義と突き合わせ、ズレがあれば落ちる。
// public＝ログイン不要／any＝ログイン済みなら誰でも／役割の配列＝その役割だけ
export type Role = "rep" | "manager";
export type Allow = "public" | "any" | readonly Role[];
export type Rule = { method: string; path: string; allow: Allow };

const REP: readonly Role[] = ["rep"];
const MANAGER: readonly Role[] = ["manager"];

const rule = (method: string, path: string, allow: Allow): Rule => ({ method, path: `/api${path}`, allow });

export const RULES: Rule[] = [
  rule("GET", "/health", "public"),
  rule("POST", "/login", "public"),

  rule("POST", "/logout", "any"),
  rule("GET", "/me", "any"),
  rule("GET", "/rubric", "any"),

  // 取引先の記録。読むのは会社の範囲で全員。確定と候補の承認は上司だけ（確定はハンドラで見る）
  rule("GET", "/accounts", "any"),
  rule("GET", "/accounts/:id", "any"),
  rule("GET", "/buyers", "any"),
  rule("GET", "/buyers/:id", "any"),
  rule("GET", "/meetings/:id", "any"),
  rule("POST", "/meetings", "any"),
  rule("PATCH", "/meetings/:id", "any"),
  rule("POST", "/priorities/:id", MANAGER),
  rule("POST", "/promises/:id", "any"),
  rule("GET", "/accounts/:id/handoffs", "any"),
  rule("POST", "/accounts/:id/handoffs", "any"),
  rule("GET", "/handoffs/:id", "any"),

  // 相手の棚。候補は上司だけが見る（若手には承認済みだけを返す）
  rule("GET", "/accounts/:id/interests", "any"),
  rule("POST", "/accounts/:id/read-site", MANAGER),
  rule("POST", "/interests/:id", MANAGER),
  rule("GET", "/buyers/:id/observations", "any"),
  rule("GET", "/season-events", "any"),

  // 準備・練習・振り返りは本人の画面。上司はここに入れない
  rule("GET", "/preps/buyers", REP),
  rule("GET", "/preps", REP),
  rule("POST", "/preps", REP),
  rule("GET", "/preps/:id", REP),
  rule("PATCH", "/preps/:id", REP),
  rule("GET", "/preps/:id/judgment", REP),
  rule("POST", "/preps/:id/turn", REP),
  rule("POST", "/preps/:id/retry", REP),
  rule("POST", "/preps/:id/consult", REP),
  rule("POST", "/preps/:id/consult/send", REP),
  rule("GET", "/preps/:id/brief", REP),
  rule("GET", "/preps/:id/recap", REP),
  rule("POST", "/practice", REP),
  rule("POST", "/practice/:id/turn", REP),
  rule("POST", "/practice/:id/check", REP),
  rule("POST", "/recordings", REP),

  // 上司の画面
  rule("GET", "/consults", MANAGER),
  rule("GET", "/drafts", MANAGER),
  rule("POST", "/drafts", MANAGER),
  rule("POST", "/drafts/:id", MANAGER),
];

const matches = (pattern: string, path: string) => {
  const a = pattern.split("/");
  const b = path.split("/");
  return a.length === b.length && a.every((seg, i) => (seg.startsWith(":") ? b[i] !== "" : seg === b[i]));
};

export const findRule = (method: string, path: string): Rule | undefined => {
  const m = method === "HEAD" ? "GET" : method;
  return RULES.find((r) => r.method === m && matches(r.path, path));
};
