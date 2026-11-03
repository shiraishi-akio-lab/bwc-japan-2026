// 評価セットで一致率を測る：ケースカード（層2）を「渡さない」場合と「渡す」場合で、
// 確かめる係＋次を決める係の出力が、人の正解とどれだけ一致するかを比べる。
// 使い方：npm run eval            （正解が書かれている項目すべて）
//         npm run eval -- eval-01 eval-02   （指定した項目だけ）
// 一致の数え方はコードで行う。Claude には「一致するか」の判定（はい／いいえ）だけを頼む。
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { check, decideNext, selectCards, type Turn } from "../worker/claude";
import type { CaseCard } from "../worker/types";

type EvalItem = {
  id: string;
  situation: string;
  answer: { missed_premise: string; axis: string; next_action: string };
};

const root = path.resolve(import.meta.dirname, "..");
const readDir = <T>(dir: string): T[] =>
  fs
    .readdirSync(path.join(root, dir))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(root, dir, f), "utf8")) as T);

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error(".dev.vars に ANTHROPIC_API_KEY がありません");
  process.exit(1);
}

const only = process.argv.slice(2);
const items = readDir<EvalItem>("data/eval").filter(
  (e) => e.answer.axis && e.answer.next_action && (only.length === 0 || only.includes(e.id)),
);
if (items.length === 0) {
  console.error("正解が書かれた評価項目がありません（knowledge/eval/ に書いて npm run knowledge）");
  process.exit(1);
}
const cards = readDir<CaseCard>("data/cases").filter((c) => c.status === "approved");

const JudgeSchema = z.object({ premiseCovered: z.boolean(), nextActionMatch: z.boolean(), reason: z.string() });
const judgeClient = new Anthropic({ apiKey });

async function judge(item: EvalItem, missing: string[], action: string) {
  const res = await judgeClient.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(JudgeSchema) },
    system:
      "あなたは採点の補助です。AI の出力が、人が書いた正解と同じことを言っているかだけを判定します。言い回しの違いは問いません。中身が同じ方向で、正解の要点を含んでいれば一致とします。",
    messages: [
      {
        role: "user",
        content: [
          `## 場面\n${item.situation}`,
          `## 正解：見落とした前提\n${item.answer.missed_premise}`,
          `## 正解：次の一手\n${item.answer.next_action}`,
          `## AI が挙げた「抜けていること」\n${missing.map((m) => `- ${m}`).join("\n")}`,
          `## AI が選んだ次の一行動\n${action}`,
          "premiseCovered：正解の「見落とした前提」が、AI の「抜けていること」のどれかに含まれているか。nextActionMatch：AI の次の一行動が、正解の「次の一手」と同じ行動か。",
        ].join("\n\n"),
      },
    ],
  });
  if (!res.parsed_output) throw new Error("判定の応答が得られませんでした");
  return res.parsed_output;
}

type Row = {
  id: string;
  condition: "カードなし" | "カードあり";
  axis: string;
  axisMatch: boolean;
  premiseCovered: boolean;
  nextActionMatch: boolean;
  action: string;
  reason: string;
  picked: string[];
  error?: string;
};

async function runOne(item: EvalItem, useCards: boolean): Promise<Row> {
  const condition = useCards ? "カードあり" : "カードなし";
  const given = useCards ? cards : [];
  // 評価セットは会話の全文ではなく場面の要約。バイヤーの発言（『』）は分けて渡す
  const buyerLines = [...item.situation.matchAll(/バイヤー『(.+?)』/g)].map((m) => m[1]);
  const turns: Turn[] = [
    { role: "rep", content: `（場面の要約）${item.situation.replace(/バイヤー『.+?』。?/g, "").trim()}` },
    ...buyerLines.map((content) => ({ role: "buyer" as const, content })),
  ];
  const memo = "（評価用の注記）この記録は場面の要約です。要約に書かれていない行動は、していないものとして扱ってください。";
  try {
    const picked = await selectCards(apiKey!, turns, given);
    const result = await check(apiKey!, turns, memo, picked);
    const next = await decideNext(apiKey!, turns, result, picked);
    const missing = result.axes.flatMap((a) => a.missing.map((m) => m.text));
    const j = await judge(item, missing, next.action);
    return {
      id: item.id,
      condition,
      axis: next.axis,
      axisMatch: item.answer.axis.split(",").includes(next.axis),
      premiseCovered: j.premiseCovered,
      nextActionMatch: j.nextActionMatch,
      action: next.action,
      reason: j.reason,
      picked: picked.map((c) => c.id),
    };
  } catch (e) {
    const error = (e as Error).message;
    return { id: item.id, condition, axis: "", axisMatch: false, premiseCovered: false, nextActionMatch: false, action: "", reason: "", picked: [], error };
  }
}

// 同時に投げすぎない
async function pool<T>(tasks: (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < tasks.length) {
        const k = i++;
        out[k] = await tasks[k]();
      }
    }),
  );
  return out;
}

console.log(`評価 ${items.length} 件 × 2条件（カードなし／カードあり ${cards.length} 件）を実行します…`);
const rows = await pool(
  items.flatMap((item) => [() => runOne(item, false), () => runOne(item, true)]),
  4,
);

const pct = (n: number, d: number) => (d === 0 ? "-" : `${Math.round((n / d) * 100)}%`);
const summary = (["カードなし", "カードあり"] as const).map((condition) => {
  // 答えを出せなかった項目も「一致しなかった」として分母に入れる（都合の悪い件を外さない）
  const rs = rows.filter((r) => r.condition === condition);
  return {
    condition,
    n: rs.length,
    axis: pct(rs.filter((r) => r.axisMatch).length, rs.length),
    premise: pct(rs.filter((r) => r.premiseCovered).length, rs.length),
    nextAction: pct(rs.filter((r) => r.nextActionMatch).length, rs.length),
  };
});

console.log("\n| 条件 | 件数 | 軸の一致 | 見落とした前提を拾えた | 次の一手の一致 |");
console.log("|---|---|---|---|---|");
for (const s of summary) console.log(`| ${s.condition} | ${s.n} | ${s.axis} | ${s.premise} | ${s.nextAction} |`);
for (const r of rows.filter((r) => r.error)) console.log(`✗ ${r.id}（${r.condition}）：${r.error}`);

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(root, "eval-results");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${stamp}.json`);
fs.writeFileSync(outFile, JSON.stringify({ ranAt: new Date().toISOString(), cards: cards.map((c) => c.id), summary, rows }, null, 2) + "\n");
console.log(`\n明細：${path.relative(root, outFile)}`);
