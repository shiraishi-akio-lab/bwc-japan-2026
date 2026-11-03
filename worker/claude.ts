import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import rubric from "../data/rubric.json";
import world from "../data/world.json";
import type { CaseCard } from "./types";

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

// 選ぶ係：カードを全部渡すと、どの場面にも当てはまるチェックリストとして使われてしまう。
// 「効く条件」がこの記録に当てはまるカードだけを先に選び、確かめる係と次を決める係にはそれだけを渡す
const SelectSchema = z.object({ picks: z.array(z.object({ caseId: z.string(), why: z.string() })) });
const MAX_PICKS = 3;

const SELECT_SYSTEM = `あなたは商談練習の「カードを選ぶ係」です。練習の記録を読み、ベテランの判断の記録（ケースカード）のうち、この記録の場面に当てはまるものだけを選びます。

## 選び方
- 各カードの appliesWhen（効く条件）が、この記録の中で実際に起きているかで判断する。記録に手がかり（相手の言葉・提案の種類・相手の事情）が無いものは選ばない。
- 「どんな商談にも言える」という理由では選ばない。
- 最大${MAX_PICKS}枚。当てはまるものが無ければ、picks は空にする。
- why には、記録のどの発言・どの事情が効く条件に当たるかを1文で書く。日本語。`;

export async function selectCards(apiKey: string, turns: Turn[], cards: CaseCard[]): Promise<CaseCard[]> {
  if (cards.length === 0) return [];
  const transcript = turns.map((t) => `${t.role === "rep" ? "若手" : "バイヤー"}：${t.content}`).join("\n");
  const index = cards.map(({ id, scene, appliesWhen, situation }) => ({ id, scene, appliesWhen, situation }));
  const res = await client(apiKey).beta.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    ...FALLBACK,
    output_config: { effort: "low", format: zodOutputFormat(SelectSchema) },
    system: [{ type: "text", text: SELECT_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `## ケースカード\n${JSON.stringify(index, null, 2)}\n\n## 練習の記録\n${transcript}` }],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error("カードを選ぶ係の応答が得られませんでした");
  const byId = new Map(cards.map((c) => [c.id, c]));
  const picked = [...new Set(res.parsed_output.picks.map((p) => p.caseId))].flatMap((id) => byId.get(id) ?? []);
  return picked.slice(0, MAX_PICKS);
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

const checkSystem = (cards: CaseCard[]) => `あなたは商談練習の「確かめる係」です。若手営業とバイヤー役の練習の記録と、若手が書いた3分メモを読み、物差しの5つの軸ごとに「できていること」と「抜けていること」を書き出します。

## 物差し（この軸と観察できる行動だけを基準にする）
${JSON.stringify(rubric.axes, null, 2)}

## ケースカード（ベテランの判断の記録。承認済みのものだけ）
${cards.length > 0 ? JSON.stringify(cards, null, 2) : "（なし）"}

## 書き方の決まり
- 5つの軸すべてについて1件ずつ出す。
- 「できていること」は、記録の中の若手の発言をそのまま quote に引く。引けないものは書かない。
- 「抜けていること」には、根拠になるケースカードの id を caseIds に入れる。当てはまるカードが無ければ空にする。
- 記録が短いなどで、その軸を判断する材料が無いときは unknown を true にし、done と missing は空にする。推測で埋めない。
- 点数・順位・総合評価は出さない。人を評価する言葉（優秀、未熟など）を使わない。
- 1項目は1文。日本語。`;

export async function check(apiKey: string, turns: Turn[], memo: string, cards: CaseCard[]): Promise<CheckResult> {
  const transcript = turns.map((t) => `${t.role === "rep" ? "若手" : "バイヤー"}：${t.content}`).join("\n");
  const res = await client(apiKey).beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: "high", format: zodOutputFormat(CheckSchema) },
    system: [{ type: "text", text: checkSystem(cards), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `## 練習の記録\n${transcript}\n\n## 3分メモ\n${memo || "（未記入）"}` }],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error("確かめる係の応答が得られませんでした");
  return enforceSources(res.parsed_output, turns, cards);
}

// 次を決める係：抜けていることの中から、次の練習で鍛える一行動を1つだけ選ぶ
const NextSchema = z.object({
  axis: z.enum(AXIS_IDS),
  action: z.string(),
  reason: z.string(),
  caseId: z.string(),
  tryLine: z.string(),
});
// insufficient：記録が短く、抜けていることを1つも挙げられなかった（止まらずに、そのことを返す）
export type NextAction = Omit<z.infer<typeof NextSchema>, "axis"> & { axis: string; otherCount: number; insufficient?: boolean };

const INSUFFICIENT: NextAction = {
  axis: "",
  action: "この記録では、次の一手を決める材料が足りません。もう少し商談を続けて、相手の事情を1つ聞き出してから振り返ってください。",
  reason: "どの軸でも、できていること・抜けていることを記録から読み取れませんでした。",
  caseId: "",
  tryLine: "差し支えなければ、今いちばん気にされていることを教えていただけますか？",
  otherCount: 0,
  insufficient: true,
};

const nextSystem = (cards: CaseCard[]) => `あなたは商談練習の「次を決める係」です。確かめる係が出した「抜けていること」の一覧から、この若手が次の練習で鍛える行動を**1つだけ**選びます。

## 物差し
${JSON.stringify(rubric.axes, null, 2)}

## ケースカード（承認済み）
${cards.length > 0 ? JSON.stringify(cards, null, 2) : "（なし）"}

## 選び方
- 上のケースカードは、この場面に当てはまるとして選ばれたものです。カードがあるときは、そのカードの nextJudgment（ベテランの次の判断）を出発点にして、この若手が次の練習でできる一行動に直す。一般論に言い換えない。
- 「提案の前に聞く」「相手の反対を言い換える」のような土台を選んでよいのは、記録の中の若手の発言から、土台が崩れていることが読み取れるときだけ。記録に書かれていない、というだけでは選ばない。
- カードが無いときは、若手の今の理解に合わせる。土台が抜けているなら土台を、できているなら一段上の行動を選ぶ。
- 練習の記録でバイヤーが反発した場面に結びつくものを優先する（本人が手応えとして覚えている所から直す）。
- 次の練習1回でできる大きさにする。「お客様理解を深める」のような広い言葉にしない。
- caseId には、その行動の手本になるケースカードの id を1つ入れる。当てはまるものが無ければ空にする。
- tryLine には、次の練習でそのまま口に出せる一言を書く（例：「どこが同じに見えましたか？」）。
- reason は1文。なぜ今これなのかを、記録の場面に触れて書く。
- 点数・人を評価する言葉は使わない。日本語。`;

export async function decideNext(apiKey: string, turns: Turn[], result: CheckResult, cards: CaseCard[]): Promise<NextAction> {
  const missing = result.axes.flatMap((a) => a.missing.map((m) => ({ axis: a.axis, ...m })));
  if (missing.length === 0) return INSUFFICIENT;
  const transcript = turns.map((t) => `${t.role === "rep" ? "若手" : "バイヤー"}：${t.content}`).join("\n");
  const res = await client(apiKey).beta.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    ...FALLBACK,
    output_config: { effort: "medium", format: zodOutputFormat(NextSchema) },
    system: [{ type: "text", text: nextSystem(cards), cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `## 練習の記録\n${transcript}\n\n## 確かめる係の結果\n${JSON.stringify(result.axes, null, 2)}`,
      },
    ],
  });
  const next = res.parsed_output;
  if (res.stop_reason === "refusal" || !next) throw new Error("次を決める係の応答が得られませんでした");
  // 選んだ軸に「抜けていること」が無い／カードが承認済みでない、はコードで直す
  const axisMissing = missing.filter((m) => m.axis === next.axis);
  const axis = axisMissing.length > 0 ? next.axis : missing[0].axis;
  const ids = new Set(cards.map((c) => c.id));
  return { ...next, axis, caseId: ids.has(next.caseId) ? next.caseId : "", otherCount: missing.length - 1 };
}

// 本番の商談の文字起こし（録音アプリで話者分け済み）を、若手／バイヤーの発言に分ける
const SplitSchema = z.object({
  repSpeaker: z.string(),
  buyerSpeaker: z.string(),
  turns: z.array(z.object({ speaker: z.string(), text: z.string() })),
});

const SPLIT_SYSTEM = `あなたは商談の文字起こしを読み、発言を話者ごとに並べ直す係です。文字起こしは録音アプリが話者分けしたもので、話者名は「話者1」「Speaker A」や人の名前などになっています。

## やること
- 文字起こしに出てくる話者名を、そのまま speaker に入れて、発言を順番どおりに turns に並べる。時刻や記号は外してよい。
- text には、文字起こしの文をそのまま写す。言い換え・要約・補いをしない。
- 話の中身から、どの話者がメーカーの営業（若手）で、どの話者がバイヤー（提案を受ける側）かを判断し、repSpeaker と buyerSpeaker に話者名を入れる。
- 3人以上いる場合も、営業側とバイヤー側でいちばん多く話している人をそれぞれ選ぶ。`;

export async function splitTranscript(apiKey: string, transcript: string): Promise<Turn[]> {
  const res = await client(apiKey).beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: "low", format: zodOutputFormat(SplitSchema) },
    system: [{ type: "text", text: SPLIT_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `## 文字起こし\n${transcript}` }],
  });
  const out = res.parsed_output;
  if (res.stop_reason === "refusal" || !out) throw new Error("文字起こしを読み取れませんでした");
  // 文字起こしに無い文は採らない（要約や補いを混ぜない）
  const flat = transcript.replace(/\s+/g, "");
  const turns: Turn[] = out.turns
    .filter((t) => t.text.trim() && flat.includes(t.text.replace(/\s+/g, "")))
    .flatMap((t): Turn[] =>
      t.speaker === out.repSpeaker
        ? [{ role: "rep", content: t.text.trim() }]
        : t.speaker === out.buyerSpeaker
          ? [{ role: "buyer", content: t.text.trim() }]
          : [],
    );
  if (!turns.some((t) => t.role === "rep")) throw new Error("営業側の発言を見つけられませんでした");
  return turns;
}

// 整理する係：ベテランの語りから、ケースカードの候補を作る（承認は人）
const NOT_SAID = "（語りに無い）";
const DraftSchema = z.object({
  title: z.string(),
  scene: z.string(),
  axes: z.array(z.enum(AXIS_IDS)),
  appliesWhen: z.string(),
  situation: z.string(),
  hypothesis: z.string(),
  evidence: z.string(),
  proposal: z.string(),
  constraints: z.string(),
  result: z.string(),
  nextJudgment: z.string(),
  rejectedOptions: z.array(z.object({ option: z.string(), reason: z.string() })),
  questionsForVeteran: z.array(z.string()),
});
export type CardDraft = z.infer<typeof DraftSchema>;

const ORGANIZE_SYSTEM = `あなたは「整理する係」です。ベテラン営業が語った商談の思い出を、ケースカードの形に整理します。カードは若手の練習で「根拠」として使われるので、語られていないことを足してはいけません。

## 物差し（axes はこの id から1〜2個）
${JSON.stringify(rubric.axes.map(({ id, name, question }) => ({ id, name, question })), null, 2)}

## 書き方の決まり
- 語りに書かれていることだけを使う。語りに無い項目は「${NOT_SAID}」とする。推測で埋めない。
- appliesWhen（効く条件）は、このカードの判断が当てはまる場面を「〜のとき」の1文で書く（相手の言葉・提案の種類・相手の事情など、記録から見分けられる手がかりで）。語りから読み取れなければ「${NOT_SAID}」。
- situation（状況）／hypothesis（仮説）／evidence（根拠）／proposal（提案）／constraints（制約）／result（結果）／nextJudgment（次の判断）は、それぞれ1〜2文。
- rejectedOptions は、ベテランが「あえてやらなかったこと」と、その理由。語りに無ければ空。
- questionsForVeteran には、カードを確かなものにするためにベテランへ聞き返したいことを、「${NOT_SAID}」の項目を中心に最大3つ書く。
- 実在の企業・店舗・人物・地域の名前が語りに出てきたら、「あるチェーン」「ある店」のように伏せる。
- title は「何が起きた商談か」が分かる1行。scene は場面の短い名前（例：初回提案、他社と同じ企画）。日本語。`;

export async function organize(apiKey: string, story: string): Promise<CardDraft> {
  const res = await client(apiKey).beta.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    ...FALLBACK,
    output_config: { effort: "medium", format: zodOutputFormat(DraftSchema) },
    system: [{ type: "text", text: ORGANIZE_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `## ベテランの語り\n${story}` }],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error("整理する係の応答が得られませんでした");
  return res.parsed_output;
}

// 出典の決まりはコードで守らせる：引用が記録に無い・カード id が存在しない、は落とす
export function enforceSources(result: CheckResult, turns: Turn[], cards: CaseCard[]): CheckResult {
  const repText = turns.filter((t) => t.role === "rep").map((t) => t.content).join("\n");
  const ids = new Set(cards.map((c) => c.id));
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
