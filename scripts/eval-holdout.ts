// 人の答えをカードにすると一致率が上がるかの測定：評価セットの正解を、その場でだけカードの形にして渡す（保存しない）。
// 使い方：npm run eval:holdout
// 12件を奇数と偶数に分け、片方の正解をカードにしてもう片方で測り、入れ替える＝測る場面の答えは見せない。
// 「同じ場面の答えも入れた」は答えを見せているので上限の確認にだけ使い、成果には使わない。
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
const odd = items.filter((_, i) => i % 2 === 0);
const even = items.filter((_, i) => i % 2 === 1);
const others = (item: EvalItem) => (odd.includes(item) ? even : odd).map(asCard);

type Mode = "none" | "select" | "given" | "ceiling";
const runs: { mode: Mode; label: string }[] = [
  ...[1, 2, 3].map((n) => ({ mode: "none" as const, label: `カードなし-${n}` })),
  ...[1, 2, 3].map((n) => ({ mode: "select" as const, label: `別の場面の答え・係が選ぶ-${n}` })),
  ...[1, 2, 3].map((n) => ({ mode: "given" as const, label: `別の場面の答え・全部渡す-${n}` })),
  ...[1, 2].map((n) => ({ mode: "ceiling" as const, label: `同じ場面の答えも入れた-${n}` })),
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

async function runOne(item: EvalItem, run: (typeof runs)[number]) {
  const buyerLines = [...item.situation.matchAll(/バイヤー『(.+?)』/g)].map((m) => m[1]);
  const turns: Turn[] = [
    { role: "rep", content: `（場面の要約）${item.situation.replace(/バイヤー『.+?』。?/g, "").trim()}` },
    ...buyerLines.map((content) => ({ role: "buyer" as const, content })),
  ];
  const memo = "（評価用の注記）この記録は場面の要約です。要約に書かれていない行動は、していないものとして扱ってください。";
  const base = { id: item.id, mode: run.mode, label: run.label };
  try {
    const picked =
      run.mode === "none" ? []
      : run.mode === "given" ? others(item)
      : await selectCards(apiKey!, turns, run.mode === "select" ? others(item) : items.map(asCard));
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
for (const r of rows.filter((r) => "error" in r)) console.log(`✗ ${r.id}（${r.label}）`);

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outFile = path.join(root, "eval-results", `holdout-${stamp}.json`);
fs.writeFileSync(outFile, JSON.stringify({ ranAt: new Date().toISOString(), rows }, null, 2) + "\n");
console.log(`\n明細：${path.relative(root, outFile)}`);
