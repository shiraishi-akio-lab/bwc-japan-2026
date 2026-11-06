// デモの架空ユーザーを手元の D1 に入れる。パスワードはここでランダムに作り、.demo-users.local にだけ残す（リポジトリに入れない）。
// 使い方：npm run demo:users              すでに .demo-users.local があれば同じパスワードで入れ直す
//         npm run demo:users -- --rotate  全員のパスワードを作り直す（ログイン中のセッションも切る）
// パスワードはコンソールに出さない。手元の D1 だけに書く。
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getPlatformProxy } from "wrangler";
import { hashPassword } from "../worker/auth";

const root = path.resolve(import.meta.dirname, "..");
const FILE = path.join(root, ".demo-users.local");
const OTHER_COMPANY = { id: "co-tsukikage", name: "ツキカゲ製菓（架空）" }; // 会社の範囲を確かめるだけの会社

type Key = "rep" | "manager" | "otherRep" | "otherCompanyManager";
type Seed = { key: Key; id: string; companyId: string; email: string; displayName: string; role: "rep" | "manager"; managerId: string | null };

const USERS: Seed[] = [
  { key: "manager", id: "user-manager", companyId: "co-mizunagi", email: "joshi@mizunagi.example", displayName: "水野 営業課長（架空）", role: "manager", managerId: null },
  { key: "rep", id: "user-morikawa", companyId: "co-mizunagi", email: "morikawa@mizunagi.example", displayName: "森川（架空）", role: "rep", managerId: "user-manager" },
  { key: "otherRep", id: "user-kirishima", companyId: "co-mizunagi", email: "kirishima@mizunagi.example", displayName: "霧島（架空）", role: "rep", managerId: "user-manager" },
  { key: "otherCompanyManager", id: "user-other-manager", companyId: OTHER_COMPANY.id, email: "joshi@tsukikage.example", displayName: "別の会社の上司（架空）", role: "manager", managerId: null },
];

type Saved = Record<Key, { email: string; password: string }>;
const rotate = process.argv.includes("--rotate");
const saved: Partial<Saved> = !rotate && fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : {};

const proxy = await getPlatformProxy<{ DB: D1Database }>();
const db = proxy.env.DB;
const out = {} as Saved;

await db.prepare("INSERT INTO companies (id, name) VALUES (?, ?) ON CONFLICT(id) DO NOTHING").bind(OTHER_COMPANY.id, OTHER_COMPANY.name).run();
for (const u of USERS) {
  const password = saved[u.key]?.password ?? randomBytes(18).toString("base64url");
  await db.prepare(
    `INSERT INTO users (id, company_id, email, display_name, role, manager_id, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET company_id = excluded.company_id, email = excluded.email, display_name = excluded.display_name,
       role = excluded.role, manager_id = excluded.manager_id, password_hash = excluded.password_hash`,
  ).bind(u.id, u.companyId, u.email, u.displayName, u.role, u.managerId, await hashPassword(password)).run();
  out[u.key] = { email: u.email, password };
}
if (rotate) await db.prepare("DELETE FROM login_sessions").run();
await proxy.dispose();

fs.writeFileSync(FILE, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
fs.chmodSync(FILE, 0o600);
console.log(`架空ユーザー ${USERS.length} 人を手元の D1 に入れました（パスワードは .demo-users.local${rotate ? "・作り直し済み" : ""}）`);
