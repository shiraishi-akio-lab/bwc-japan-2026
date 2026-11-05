// 似た場面で育つかの測定：元の場面の人の答えをカードにして 0→4→8→12枚と増やし、文面を変えた場面（eval-results/variants.json）で測る。
// 使い方：npm run eval:variants のあと npm run eval:similar
// 正解は元の評価セットのもの。書き換えの係には正解を見せていない。
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { check, decideNext, selectCards, type Turn } from "../worker/claude";
import type { CaseCard } from "../worker/types";

type EvalItem = { id: string; situation: string; answer: { missed_premise: string; axis: string; next_action: string } };

const root = path.resolve(import.meta.dirname, "..");
const readDir = <T>(dir: string): T[] =>
  fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".json")).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(root, dir, f), "utf8")) as T);

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error(".dev.vars に ANTHROPIC_API_KEY がありません");
  process.exit(1);
}

const items = readDir<EvalItem>("data/eval").filter((e) => e.answer.axis && e.answer.next_action);

const asCard = (e: EvalItem): CaseCard => ({
  id: `answer-${e.id}`,
  title: e.situation,
  status: "approved",
  scene: "商談",
  axes: e.answer.axis.split(",") as CaseCard["axes"],
  appliesWhen: `${e.situation}このような場面のとき。`,
  situation: e.situation,
  hypothesis: "（記録なし）",
  evidence: "（記録なし）",
  proposal: "（記録なし）",
  constraints: `見落としていた前提：${e.answer.missed_premise}`,
  result: "（記録なし）",
  nextJudgment: e.answer.next_action,
  rejectedOptions: [],
  author: "人の答え（評価セット）",
});
const variants = new Map((JSON.parse(fs.readFileSync(path.join(root, "eval-results/variants.json"), "utf8")) as { id: string; situation: string }[]).map((v) => [v.id, v.situation]));

// 並びは固定の種で決める（同じ測定を後から再現できるように）
const shuffled = (seed: number) => {
  const a = [...items];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const orderA = shuffled(1);
const orderB = shuffled(2);
const runs: { stage: number; label: string; given: EvalItem[] }[] = [
  { stage: 0, label: "0枚-1回目", given: [] },
  { stage: 0, label: "0枚-2回目", given: [] },
  { stage: 4, label: "4枚-並びA", given: orderA.slice(0, 4) },
  { stage: 4, label: "4枚-並びB", given: orderB.slice(0, 4) },
  { stage: 8, label: "8枚-並びA", given: orderA.slice(0, 8) },
  { stage: 8, label: "8枚-並びB", given: orderB.slice(0, 8) },
  { stage: 12, label: "12枚-1回目", given: items },
  { stage: 12, label: "12枚-2回目", given: items },
];

const JudgeSchema = z.object({ premiseCovered: z.boolean(), nextActionMatch: z.boolean(), reason: z.string() });
const judgeClient = new Anthropic({ apiKey });

async function judge(item: EvalItem, missing: string[], action: string) {
  const res = await judgeClient.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(JudgeSchema) },
    system:
      "あなたは採点の補助です。AI の出力が、人が書いた正解と同じことを言っているかだけを判定します。言い回しの違いは問いません。中身が同じ方向で、正解の要点を含んでいれば一致とします。",
    messages: [{
      role: "user",
      content: [
        `## 場面\n${item.situation}`,
        `## 正解：見落とした前提\n${item.answer.missed_premise}`,
        `## 正解：次の一手\n${item.answer.next_action}`,
        `## AI が挙げた「抜けていること」\n${missing.map((m) => `- ${m}`).join("\n")}`,
        `## AI が選んだ次の一行動\n${action}`,
        "premiseCovered：正解の「見落とした前提」が、AI の「抜けていること」のどれかに含まれているか。nextActionMatch：AI の次の一行動が、正解の「次の一手」と同じ行動か。",
      ].join("\n\n"),
    }],
  });
  if (!res.parsed_output) throw new Error("判定の応答が得られませんでした");
  return res.parsed_output;
}

async function runOne(original: EvalItem, run: (typeof runs)[number]) {
  const situation = variants.get(original.id);
  if (!situation) throw new Error(`書き換えがありません：${original.id}`);
  const item = { ...original, situation };
  const buyerLines = [...situation.matchAll(/バイヤー『(.+?)』/g)].map((m) => m[1]);
  const turns: Turn[] = [
    { role: "rep", content: `（場面の要約）${situation.replace(/バイヤー『.+?』。?/g, "").trim()}` },
    ...buyerLines.map((content) => ({ role: "buyer" as const, content })),
  ];
  const memo = "（評価用の注記）この記録は場面の要約です。要約に書かれていない行動は、していないものとして扱ってください。";
  const covered = run.given.some((g) => g.id === original.id);
  const base = { id: original.id, stage: run.stage, label: run.label, covered };
  try {
    const picked = await selectCards(apiKey!, turns, run.given.map(asCard));
    const result = await check(apiKey!, turns, memo, picked);
    const next = await decideNext(apiKey!, turns, result, picked);
    const j = await judge(item, result.axes.flatMap((a) => a.missing.map((m) => m.text)), next.action);
    return { ...base, axis: next.axis, axisMatch: item.answer.axis.split(",").includes(next.axis), premiseCovered: j.premiseCovered, nextActionMatch: j.nextActionMatch, action: next.action, reason: j.reason, picked: picked.map((c) => c.id) };
  } catch (e) {
    // 答えを出せなかった項目も「一致しなかった」として分母に入れる（都合の悪い件を外さない）
    return { ...base, axis: "", axisMatch: false, premiseCovered: false, nextActionMatch: false, action: "", reason: "", picked: [] as string[], error: (e as Error).message };
  }
}

async function pool<T>(tasks: (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < tasks.length) {
      const k = i++;
      out[k] = await tasks[k]();
    }
  }));
  return out;
}

console.log(`評価 ${items.length} 件 × ${runs.length} 回を実行します…`);
const rows = await pool(runs.flatMap((run) => items.map((item) => () => runOne(item, run))), 6);

const pct = (n: number, d: number) => `${Math.round((n / d) * 100)}%`;
const line = (name: string, rs: typeof rows) =>
  `| ${name} | ${rs.length} | ${pct(rs.filter((r) => r.axisMatch).length, rs.length)} | ${pct(rs.filter((r) => r.premiseCovered).length, rs.length)} | ${pct(rs.filter((r) => r.nextActionMatch).length, rs.length)} | ${rs.filter((r) => r.picked.length > 0).length} |`;
console.log("\n| 条件 | 件数 | 軸 | 見落とした前提 | 次の一手 | カードを使った件数 |\n|---|---|---|---|---|---|");
for (const run of runs) console.log(line(run.label, rows.filter((r) => r.label === run.label)));
console.log("\n段階ごとの合計");
for (const stage of [0, 4, 8, 12]) console.log(line(`${stage}枚`, rows.filter((r) => r.stage === stage)));
console.log("\nカードが入っている場面／入っていない場面（4枚・8枚）");
console.log(line("入っている", rows.filter((r) => r.stage % 12 !== 0 && r.covered)));
console.log(line("入っていない", rows.filter((r) => r.stage % 12 !== 0 && !r.covered)));
for (const r of rows.filter((r) => "error" in r)) console.log(`✗ ${r.id}（${r.label}）`);

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outFile = path.join(root, "eval-results", `similar-${stamp}.json`);
fs.writeFileSync(outFile, JSON.stringify({ ranAt: new Date().toISOString(), runs: runs.map((r) => ({ label: r.label, cards: r.given.map((g) => g.id) })), rows }, null, 2) + "\n");
console.log(`\n明細：${path.relative(root, outFile)}`);
