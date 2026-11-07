import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { DAY_LIMITS, findRule } from "./access";
import type { AppEnv, SessionUser } from "./types";

const ITERATIONS = 100_000; // PBKDF2 の反復回数
const SESSION_SECONDS = 8 * 60 * 60;
const DAY = 24 * 60 * 60;
const MAX_EMAIL = 254;
const MAX_PASSWORD = 200;

// 回数の上限。ロックは上限に届いた時点から数える
export const LOGIN_LIMITS = {
  email: { limit: 5, windowSeconds: 15 * 60, lockSeconds: 30 * 60 },
  ip: { limit: 50, windowSeconds: 15 * 60, lockSeconds: 30 * 60 },
};

// 入口の2つのボタン。架空の2人だけに、パスワードなしで入れる
const DEMO_USERS = { rep: "user-morikawa", manager: "user-manager" } as const;
export const DEMO_ENTRY_LIMIT = { limit: 30, windowSeconds: 15 * 60 };
// 手元では常に出す。手元以外では DEMO_ENTRY=on を明示したときだけ（既定は閉じる）
export const demoEntryOn = (url: string, flag?: string) => isLocal(url) || flag === "on";
// 手元以外では合言葉も要る。合言葉が設定されていなければ、誰も入れない
export const demoPassOk = async (url: string, secret?: string, given?: string) =>
  isLocal(url) || (!!secret && !!given && (await sha256(given)) === (await sha256(secret)));

const FAILED = "メールアドレスまたはパスワードが違います";
const WRONG_PASS = "合言葉が違います";
const LOCKED = "試行が多すぎます。しばらくしてからやり直してください";

const encoder = new TextEncoder();
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (s: string) => toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(s))));

const derive = async (password: string, salt: Uint8Array, iterations: number) => {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, 256));
};

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(await derive(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, iterations, salt, hash] = stored.split("$");
  const actual = await derive(password, fromBase64(salt), Number(iterations));
  const expected = fromBase64(hash);
  let diff = actual.length ^ expected.length;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ (expected[i] ?? 0);
  return diff === 0;
}

// 無いメールでも同じだけ計算して、応答の時間で有無が分からないようにする
const NO_USER_HASH = `pbkdf2$${ITERATIONS}$${"A".repeat(22)}==$${"A".repeat(43)}=`;

// 手元の http だけ Secure を外す。それ以外は必ず Secure
const isLocal = (url: string) => ["localhost", "127.0.0.1"].includes(new URL(url).hostname);
const cookieName = (url: string) => (isLocal(url) ? "session" : "__Host-session");

export const sessionCookie = (url: string, token: string, maxAge: number) =>
  `${cookieName(url)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isLocal(url) ? "" : "; Secure"}`;

const now = () => Math.floor(Date.now() / 1000);

// 数えてから確かめる＝同時に送られても上限を超えて試せない。上限内なら true
export async function hit(db: D1Database, key: string, limit: number, windowSeconds: number, lockSeconds = windowSeconds): Promise<boolean> {
  const t = now();
  const row = await db.prepare(
    `INSERT INTO throttles (key, count, window_end) VALUES (?1, 1, ?2 + ?3)
     ON CONFLICT(key) DO UPDATE SET
       window_end = CASE WHEN window_end <= ?2 THEN ?2 + ?3 WHEN count + 1 = ?4 THEN ?2 + ?5 ELSE window_end END,
       count = CASE WHEN window_end <= ?2 THEN 1 ELSE count + 1 END
     RETURNING count`,
  ).bind(key, t, windowSeconds, limit, lockSeconds).first<{ count: number }>();
  return row!.count <= limit;
}

const publicUser = (u: SessionUser) => ({ displayName: u.display_name, email: u.email, role: u.role, companyName: u.company_name });

const USER_COLS = "u.id, u.company_id, u.email, u.display_name, u.role, u.manager_id, c.name AS company_name";

async function currentUser(db: D1Database, url: string, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  return db.prepare(
    `SELECT ${USER_COLS} FROM login_sessions s JOIN users u ON u.id = s.user_id JOIN companies c ON c.id = u.company_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(await sha256(token), now()).first<SessionUser>();
}

const newToken = () => toBase64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sessionInsert = async (db: D1Database, token: string, userId: string) =>
  db.prepare("INSERT INTO login_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), userId, now() + SESSION_SECONDS);

const isMutation = (method: string) => !["GET", "HEAD"].includes(method);

// 全 /api の入口。棚卸し表に無いものは通さない
export const guard = createMiddleware<AppEnv>(async (c, next) => {
  const { method, url } = c.req.raw;
  if (isMutation(method) && c.req.header("origin") !== new URL(url).origin) return c.json({ error: "別のサイトからの操作は受け付けません" }, 403);
  const found = findRule(method, c.req.path);
  if (found?.allow === "public") return next();
  const user = await currentUser(c.env.DB, url, getCookie(c, cookieName(url)));
  if (!user) return c.json({ error: "ログインしてください" }, 401);
  if (!found) return c.json({ error: "見つかりません" }, 404);
  if (found.allow !== "any" && !found.allow.includes(user.role)) return c.json({ error: "この操作の権限がありません" }, 403);
  if (found.limit && !(await hit(c.env.DB, `${found.limit}:${user.id}`, DAY_LIMITS[found.limit], DAY))) {
    return c.json({ error: "今日の回数の上限です。明日また使えます" }, 429);
  }
  c.set("user", user);
  await next();
});

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/login", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{ email?: unknown; password?: unknown }>().catch(() => ({}) as { email?: unknown; password?: unknown });
  const email = String(body.email ?? "").trim().toLowerCase().slice(0, MAX_EMAIL);
  const password = String(body.password ?? "").slice(0, MAX_PASSWORD);

  const emailKey = `login:email:${await sha256(email)}`;
  const ipKey = `login:ip:${await sha256(c.req.header("cf-connecting-ip") ?? "local")}`;
  const { email: byEmail, ip: byIp } = LOGIN_LIMITS;
  const [emailOk, ipOk] = await Promise.all([
    hit(db, emailKey, byEmail.limit, byEmail.windowSeconds, byEmail.lockSeconds),
    hit(db, ipKey, byIp.limit, byIp.windowSeconds, byIp.lockSeconds),
  ]);
  if (!emailOk || !ipOk) return c.json({ error: LOCKED }, 429);

  const row = await db.prepare("SELECT id, password_hash FROM users WHERE email = ?").bind(email).first<{ id: string; password_hash: string }>();
  const matched = await verifyPassword(password, row?.password_hash ?? NO_USER_HASH);
  if (!row || !matched) return c.json({ error: FAILED }, 401);

  const token = newToken();
  await db.batch([
    db.prepare("DELETE FROM throttles WHERE key = ?").bind(emailKey),
    db.prepare("UPDATE throttles SET count = MAX(count - 1, 0) WHERE key = ?").bind(ipKey), // 成功は失敗に数えない
    db.prepare("DELETE FROM login_sessions WHERE expires_at <= ?").bind(now()),
    await sessionInsert(db, token, row.id),
  ]);
  c.header("Set-Cookie", sessionCookie(c.req.url, token, SESSION_SECONDS));
  const user = await currentUser(db, c.req.url, token);
  return c.json(publicUser(user!));
});

authRoutes.get("/demo-entry", (c) => c.json({ on: demoEntryOn(c.req.url, c.env.DEMO_ENTRY), pass: !isLocal(c.req.url) }));

authRoutes.post("/demo-entry", async (c) => {
  if (!demoEntryOn(c.req.url, c.env.DEMO_ENTRY)) return c.json({ error: "見つかりません" }, 404);
  const db = c.env.DB;
  const { role, pass } = await c.req.json<{ role?: string; pass?: string }>().catch(() => ({ role: undefined, pass: undefined }));
  const userId = role === "rep" || role === "manager" ? DEMO_USERS[role] : null;
  if (!userId) return c.json({ error: "入る人を選んでください" }, 400);
  const ipKey = `demo:ip:${await sha256(c.req.header("cf-connecting-ip") ?? "local")}`;
  if (!(await hit(db, ipKey, DEMO_ENTRY_LIMIT.limit, DEMO_ENTRY_LIMIT.windowSeconds))) return c.json({ error: LOCKED }, 429);
  if (!(await demoPassOk(c.req.url, c.env.DEMO_PASS, pass))) return c.json({ error: WRONG_PASS }, 403);
  if (!(await db.prepare("SELECT 1 AS ok FROM users WHERE id = ?").bind(userId).first())) return c.json({ error: "見本の人が登録されていません" }, 503);
  const token = newToken();
  await db.batch([
    db.prepare("DELETE FROM login_sessions WHERE expires_at <= ?").bind(now()),
    await sessionInsert(db, token, userId),
  ]);
  c.header("Set-Cookie", sessionCookie(c.req.url, token, SESSION_SECONDS));
  return c.json(publicUser((await currentUser(db, c.req.url, token))!));
});

authRoutes.post("/logout", async (c) => {
  const token = getCookie(c, cookieName(c.req.url));
  if (token) await c.env.DB.prepare("DELETE FROM login_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  c.header("Set-Cookie", sessionCookie(c.req.url, "", 0));
  return c.json({ ok: true });
});

authRoutes.get("/me", (c) => c.json(publicUser(c.get("user"))));
