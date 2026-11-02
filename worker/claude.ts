import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import rubric from "../data/rubric.json";
import world from "../data/world.json";
import { approvedCases } from "./data";

const MODEL = "claude-opus-5-5";
// 安全上の判定で断られたときは、サーバー側で別のモデルに引き継ぐ
const FALLBACK = {
  betas: ["server-side-fallback-2026-07-01"] as Anthropic.Beta.AnthropicBeta[],
  fallbacks: "default" as const,
};

export type Turn = { role: "rep" | "buyer"; content: string };

export const BUYER_OPENING = "佐伯です。今日は15分しか取れないので、手短にお願いします。";

// 指示文は毎回同じ文字列にする（先頭一致でキャッシュが効く）
const BUYER_SYSTEM = `あなたは商談練習用の「バイヤー役」です。架空のドラッグストアチェーンのバイヤー、佐伯として、メーカーの若手営業と話します。

## 舞台（すべて架空）
${JSON.stringify(world, null, 2)}

## 佐伯が知っていて、自分からは言わないこと
相手が的確に聞いてきたときだけ、短く答える。聞かれなければ言わない。
- 飲料の棚で、動きの悪い商品が2〜3品ある（入れ替え候補）。
- 次の棚割り改定は3月。決めるのはその2か月前まで。
- 今年は「健康を軸にした売場」で来店頻度を上げたい。無糖・機能性の棚を見直している。
- PB の無糖炭酸の粗利は守りたい。PB と正面から並ぶ提案は通しにくい。
- 店は少人数。売場替えや大きな陳列は、作業が増えるなら断る。
- 他社からも夏の値引き企画を受けている。

## 話し方
- 日本語。1回の発言は1〜3文。忙しいバイヤーとして自然に話す。
- 値引き・商品紹介だけの話には、遠慮なく耳の痛いことを言う（例：「それ、他のチェーンにも同じ話をしていますよね」）。
- 相手が質問してきたら、それには答える。答えに数字が要るときは、舞台にある範囲だけを使う。無いものは「今は手元に無い」と言う。
- あなたは教える役ではない。助言・採点・正解の説明をしない。商談の相手として振る舞うだけ。
- 実在の企業・人物・地域の名前を出さない。`;

const client = (apiKey: string) => new Anthropic({ apiKey });

const toMessages = (turns: Turn[]): Anthropic.Beta.BetaMessageParam[] =>
  turns.map((t) => ({ role: t.role === "rep" ? "user" : "assistant", content: t.content }));

export async function buyerReply(apiKey: string, turns: Turn[]): Promise<string> {
  // 冒頭のバイヤーの挨拶は固定文。API には若手の発言から渡す
  const history = turns[0]?.role === "buyer" ? turns.slice(1) : turns;
  const res = await client(apiKey).beta.messages.create({
    model: MODEL,
    max_tokens: 2000,
    ...FALLBACK,
    output_config: { effort: "low" },
    system: [{ type: "text", text: BUYER_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: toMessages(history),
  });
  if (res.stop_reason === "refusal") throw new Error("バイヤー役の応答が得られませんでした");
  return res.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();
}

// 確かめる係：練習の記録と3分メモから、軸ごとの「できていること／抜けていること」を出す
const AXIS_IDS = rubric.axes.map((a) => a.id) as [string, ...string[]];

const CheckSchema = z.object({
  axes: z.array(
    z.object({
      axis: z.enum(AXIS_IDS),
      done: z.array(z.object({ text: z.string(), quote: z.string() })),
      missing: z.array(z.object({ text: z.string(), caseIds: z.array(z.string()) })),
      unknown: z.boolean(),
    }),
  ),
});
export type CheckResult = z.infer<typeof CheckSchema>;

const CHECK_SYSTEM = `あなたは商談練習の「確かめる係」です。若手営業とバイヤー役の練習の記録と、若手が書いた3分メモを読み、物差しの5つの軸ごとに「できていること」と「抜けていること」を書き出します。

## 物差し（この軸と観察できる行動だけを基準にする）
${JSON.stringify(rubric.axes, null, 2)}

## ケースカード（ベテランの判断の記録。承認済みのものだけ）
${JSON.stringify(approvedCases, null, 2)}

## 書き方の決まり
- 5つの軸すべてについて1件ずつ出す。
- 「できていること」は、記録の中の若手の発言をそのまま quote に引く。引けないものは書かない。
- 「抜けていること」には、根拠になるケースカードの id を caseIds に入れる。当てはまるカードが無ければ空にする。
- 記録が短いなどで、その軸を判断する材料が無いときは unknown を true にし、done と missing は空にする。推測で埋めない。
- 点数・順位・総合評価は出さない。人を評価する言葉（優秀、未熟など）を使わない。
- 1項目は1文。日本語。`;

export async function check(apiKey: string, turns: Turn[], memo: string): Promise<CheckResult> {
  const transcript = turns.map((t) => `${t.role === "rep" ? "若手" : "バイヤー"}：${t.content}`).join("\n");
  const res = await client(apiKey).beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: "high", format: zodOutputFormat(CheckSchema) },
    system: [{ type: "text", text: CHECK_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `## 練習の記録\n${transcript}\n\n## 3分メモ\n${memo || "（未記入）"}` }],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error("確かめる係の応答が得られませんでした");
  return enforceSources(res.parsed_output, turns);
}

// 出典の決まりはコードで守らせる：引用が記録に無い・カード id が存在しない、は落とす
export function enforceSources(result: CheckResult, turns: Turn[]): CheckResult {
  const repText = turns.filter((t) => t.role === "rep").map((t) => t.content).join("\n");
  const ids = new Set(approvedCases.map((c) => c.id));
  const byAxis = new Map(result.axes.map((a) => [a.axis, a]));
  return {
    axes: rubric.axes.map((axis) => {
      const a = byAxis.get(axis.id);
      if (!a || a.unknown) return { axis: axis.id, done: [], missing: [], unknown: true };
      const done = a.done.filter((d) => d.quote.trim() !== "" && repText.includes(d.quote.trim()));
      const missing = a.missing.map((m) => ({ ...m, caseIds: m.caseIds.filter((id) => ids.has(id)) }));
      return { axis: axis.id, done, missing, unknown: done.length === 0 && missing.length === 0 };
    }),
  };
}
