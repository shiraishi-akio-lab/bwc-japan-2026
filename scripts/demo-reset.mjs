// デモの初期状態に戻す：練習・準備・商談の記録を消し、migrations の見本データを入れ直す（手元の D1 だけ）。
// 取引先・バイヤー・棚は画面から変わらないので触らない。引き継ぎ書と語りの候補は残す。
// npm run dev を動かしたままでよい。使い方：npm run demo:reset
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const RESEED = ["meetings", "priorities", "promises", "initiative_results"];
const CLEAR = ["preps", "memos", "assessments", "practice_messages", "initiative_results", "promises", "priorities", "meetings", "practice_sessions"];

const seeds = fs.readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort().flatMap((f) => {
  const sql = fs.readFileSync(path.join(root, "migrations", f), "utf8");
  return [...sql.matchAll(/^INSERT INTO (\w+)[\s\S]*?;[ \t]*$/gm)].filter((m) => RESEED.includes(m[1])).map((m) => m[0]);
});

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "demo-reset-")), "reset.sql");
fs.writeFileSync(file, [...CLEAR.map((t) => `DELETE FROM ${t};`), ...seeds].join("\n") + "\n");
execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--yes", "--file", file], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
console.log(`初期状態に戻しました（消した表 ${CLEAR.length}／入れ直した見本 ${seeds.length} 文）`);
