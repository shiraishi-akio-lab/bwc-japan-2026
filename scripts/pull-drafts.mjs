// 整理する係が作ったケースカードの候補（手元の D1 の case_drafts）を、
// Obsidian の保管庫 knowledge/cards/_pending/ に Markdown で書き出す。
// すでに書き出したもの（同じファイル名）は上書きしない＝人が直した中身を守る。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "knowledge", "cards", "_pending");

const raw = execFileSync(
  "npx",
  ["wrangler", "d1", "execute", "DB", "--local", "--json", "--command",
    "SELECT id, source_text, card_json, created_at FROM case_drafts WHERE status = 'pending' ORDER BY created_at"],
  { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
);
const rows = JSON.parse(raw)[0]?.results ?? [];

const SECTIONS = [
  ["situation", "状況"], ["hypothesis", "仮説"], ["evidence", "根拠"], ["proposal", "提案"],
  ["constraints", "制約"], ["result", "結果"], ["nextJudgment", "次の判断"],
];

let written = 0;
for (const row of rows) {
  const id = `draft-${row.id.slice(0, 8)}`;
  const file = path.join(outDir, `${id}.md`);
  if (fs.existsSync(file)) continue;
  const c = JSON.parse(row.card_json);
  const front = stringify({ id, title: c.title, status: "pending", scene: c.scene, axes: c.axes, author: "整理する係（Claude）の下書き。ベテランの確認前" });
  let md = `---\n${front}---\n\n# ${c.title}\n\n> 承認するとき：id を case-XX に変え、status を approved にして、このファイルを cards/ に移す。\n`;
  for (const [k, h] of SECTIONS) md += `\n## ${h}\n${c[k]}\n`;
  md += `\n## 退けた案\n` + (c.rejectedOptions.length ? c.rejectedOptions.map((r) => `- **${r.option}**：${r.reason}`).join("\n") : "（語りに無い）") + "\n";
  md += `\n## 関連する軸\n` + c.axes.map((a) => `- [[${a}]]`).join("\n") + "\n";
  md += `\n## ベテランに聞き返したいこと\n` + (c.questionsForVeteran.length ? c.questionsForVeteran.map((q) => `- ${q}`).join("\n") : "（なし）") + "\n";
  md += `\n## 元の語り（${row.created_at}）\n${row.source_text.split("\n").map((l) => `> ${l}`).join("\n")}\n`;
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(file, md);
  written++;
  console.log(`書き出し：knowledge/cards/_pending/${id}.md（${c.title}）`);
}
console.log(`候補 ${rows.length} 件のうち、新しく書き出したもの ${written} 件`);
