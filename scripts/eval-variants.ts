// 似た場面の作成：評価セットの場面だけを渡して（正解は渡さない）、同じ種類の失敗を別の商品・別の文面に書き換える。
// 使い方：npm run eval:variants → eval-results/variants.json
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "data/eval");
const scenes = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
  const { id, situation } = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { id: string; situation: string };
  return { id, situation };
});

const Schema = z.object({ variants: z.array(z.object({ id: z.string(), situation: z.string() })) });
const res = await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).messages.parse({
  model: "claude-opus-5-5",
  max_tokens: 8000,
  output_config: { effort: "medium", format: zodOutputFormat(Schema) },
  system: `メーカー営業の商談の失敗場面を、同じ種類の失敗のまま別の場面に書き換えます。
- 商品・売場・時期・言い回しを変える。元の文と同じ語句をなるべく使わない。飲料以外の日用品・食品にしてよい。
- 失敗の種類と、バイヤーの言葉の意味は変えない。
- 元の場面に無い事情、原因の説明、解決のヒントを足さない。長さは元と同じくらい。
- バイヤーの発言があれば、バイヤー『…』の形を保つ。無ければ足さない。
- 実在の企業名を使わない。id はそのまま返す。`,
  messages: [{ role: "user", content: JSON.stringify(scenes, null, 2) }],
});
if (!res.parsed_output || res.parsed_output.variants.length !== scenes.length) throw new Error("書き換えの応答が揃いませんでした");
fs.writeFileSync(path.join(root, "eval-results/variants.json"), JSON.stringify(res.parsed_output.variants, null, 2) + "\n");
for (const v of res.parsed_output.variants) console.log(`${v.id}：${v.situation}`);
