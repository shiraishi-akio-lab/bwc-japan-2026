// knowledge/（Obsidian の保管庫）の Markdown を、アプリが読む data/*.json に変換する。
// data/rubric.json・data/cases/*.json・data/eval/*.json は生成物＝直接編集しない。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const K = path.join(root, "knowledge");
const D = path.join(root, "data");
const errors = [];

const read = (file) => {
  const text = fs.readFileSync(file, "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${path.relative(root, file)}：先頭の --- 〜 --- がありません`);
  const sections = {};
  let current = null;
  for (const line of m[2].split("\n")) {
    const h = line.match(/^## (.+)$/);
    if (h) {
      current = h[1].trim();
      sections[current] = [];
    } else if (current) {
      sections[current].push(line);
    }
  }
  const body = Object.fromEntries(
    Object.entries(sections).map(([k, v]) => [k, v.join("\n").replace(/<!--[\s\S]*?-->/g, "").trim()]),
  );
  return { meta: parse(m[1]) ?? {}, body, rel: path.relative(root, file) };
};

const mdFiles = (dir) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("_")).map((f) => path.join(dir, f)) : [];

const bullets = (s = "") => s.split("\n").map((l) => l.match(/^- (.+)$/)?.[1]).filter(Boolean);

// 誤りが1つでもあれば何も書き出さない（古い JSON のまま動く）
const outputs = new Map();
const write = (file, obj) => outputs.set(file, obj);

// 物差し
const about = read(path.join(K, "rubric", "_about.md"));
const axes = mdFiles(path.join(K, "rubric"))
  .map(read)
  .sort((a, b) => a.meta.order - b.meta.order)
  .map(({ meta, body }) => ({ id: meta.id, name: meta.name, question: body["問い"], observable: bullets(body["観察できる行動"]) }));
write(path.join(D, "rubric.json"), { _generated: "knowledge/rubric/ から生成。直接編集しない", note: about.meta.note, axes });
const axisIds = new Set(axes.map((a) => a.id));

// ケースカード。_pending/ にあるものは status に関係なく承認待ち
const cardSources = [
  ...mdFiles(path.join(K, "cards")).map((f) => [f, false]),
  ...mdFiles(path.join(K, "cards", "_pending")).map((f) => [f, true]),
];
const SECTIONS = { situation: "状況", hypothesis: "仮説", evidence: "根拠", proposal: "提案", constraints: "制約", result: "結果", nextJudgment: "次の判断" };
const cardIds = new Set();
for (const [file, pending] of cardSources) {
  const { meta, body, rel } = read(file);
  for (const a of meta.axes ?? []) if (!axisIds.has(a)) errors.push(`${rel}：軸 ${a} は物差しにありません`);
  if (cardIds.has(meta.id)) errors.push(`${rel}：id ${meta.id} が重複しています`);
  cardIds.add(meta.id);
  const card = { _generated: `${rel} から生成。直接編集しない`, id: meta.id, title: meta.title, scene: meta.scene, axes: meta.axes ?? [] };
  for (const [k, h] of Object.entries(SECTIONS)) {
    card[k] = body[h] ?? "";
    if (!card[k]) errors.push(`${rel}：「## ${h}」が空です`);
  }
  card.rejectedOptions = bullets(body["退けた案"]).map((l) => {
    const m = l.match(/^\*\*(.+?)\*\*：(.+)$/);
    return m ? { option: m[1], reason: m[2] } : { option: l, reason: "" };
  });
  card.status = !pending && meta.status === "approved" ? "approved" : "pending";
  card.author = meta.author ?? "";
  write(path.join(D, "cases", `${meta.id}.json`), card);
}

// 評価セット（正解はオーナーが Obsidian で書く）
const evalIds = new Set();
for (const file of mdFiles(path.join(K, "eval"))) {
  const { meta, body, rel } = read(file);
  const axis = body["軸"] ?? "";
  if (axis && !axisIds.has(axis)) errors.push(`${rel}：軸 ${axis} は物差しにありません`);
  evalIds.add(meta.id);
  write(path.join(D, "eval", `${meta.id}.json`), {
    _generated: `${rel} から生成。直接編集しない`,
    id: meta.id,
    situation: body["場面"] ?? "",
    answer: { missed_premise: body["見落とした前提"] ?? "", axis, next_action: body["次の一手"] ?? "" },
    note: meta.note ?? "",
  });
}

// Markdown が無くなった生成物を知らせる（消さない）
for (const [dir, ids] of [["cases", cardIds], ["eval", evalIds]]) {
  for (const f of fs.readdirSync(path.join(D, dir))) {
    if (!ids.has(f.replace(/\.json$/, ""))) errors.push(`data/${dir}/${f}：元の Markdown がありません`);
  }
}

if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join("\n"));
  console.error("data/ は書き換えていません。");
  process.exit(1);
}
for (const [file, obj] of outputs) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
}
const answered = [...outputs.values()].filter((o) => o.answer?.next_action).length;
console.log(`物差し ${axes.length} 軸／ケースカード ${cardIds.size} 件／評価セット ${evalIds.size} 件（正解あり ${answered} 件）`);
