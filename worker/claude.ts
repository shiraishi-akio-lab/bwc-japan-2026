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

export const buyerOpening = (name: string) => `${name.replace(/（架空）$/, "")}です。今日は15分しか取れないので、手短にお願いします。`;

// 指示文は毎回同じ文字列にする（先頭一致でキャッシュが効く）。相手ごとの設定は別のブロックで渡す
const BUYER_SYSTEM = `あなたは商談練習用の「バイヤー役」です。架空の小売チェーンのバイヤーとして、メーカーの若手営業と話します。

## メーカー側の舞台（すべて架空）
${JSON.stringify({ scene: world.scene, maker: world.maker, rep: world.people.rep }, null, 2)}

## 話し方
- 日本語。1回の発言は1〜3文。忙しいバイヤーとして自然に話す。発言の中身だけを書く（名前やかぎ括弧を付けない）。
- 「演じる相手」の「自分からは言わないこと」は、相手が的確に聞いてきたときだけ短く答える。聞かれなければ言わない。
- 「今大事にしていること」があるときは、それに結びつく話には身を乗り出し、結びつかない話には関心を示さない。ただし、自分から明かしはしない。
- 値引き・商品紹介だけの話には、遠慮なく耳の痛いことを言う（例：「それ、他のチェーンにも同じ話をしていますよね」）。
- 相手が質問してきたら、それには答える。答えに数字が要るときは、与えられた範囲だけを使う。無いものは「今は手元に無い」と言う。
- あなたは教える役ではない。助言・採点・正解の説明をしない。商談の相手として振る舞うだけ。
- 実在の企業・人物・地域の名前を出さない。`;

const client = (apiKey: string) => new Anthropic({ apiKey });

const recordBlock = (record: string) => (record ? `\n\n## 取引先の記録（人が確定したもの）\n${record}` : "");

const toMessages = (turns: Turn[]): Anthropic.Beta.BetaMessageParam[] =>
  turns.map((t) => ({ role: t.role === "rep" ? "user" : "assistant", content: t.content }));

export async function buyerReply(apiKey: string, turns: Turn[], persona: string): Promise<string> {
  // 冒頭のバイヤーの挨拶は固定文。API には若手の発言から渡す
  const history = turns[0]?.role === "buyer" ? turns.slice(1) : turns;
  const res = await client(apiKey).beta.messages.create({
    model: MODEL,
    max_tokens: 2000,
    ...FALLBACK,
    output_config: { effort: "low" },
    system: [
      { type: "text", text: BUYER_SYSTEM, cache_control: { type: "ephemeral" } },
      { type: "text", text: persona },
    ],
    messages: toMessages(history),
  });
  if (res.stop_reason === "refusal") throw new Error("バイヤー役の応答が得られませんでした");
  return res.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();
}

// 準備室のバイヤー役。段階はコードが持ち、立場もコードが決める。Claude は決められた立場で文面を書く
export const KEY_QUESTION = "どれを外すの？"; // 挨拶と同じく固定文
export const RETRY_LINE = "では、改めて聞きます。どれを外すの？";
export const ROUND_END_LINE = "今日はここまでにしましょう。返しを練り直して、もう一度来てください。";

export type BuyerMove = "push" | "refuse" | "hold" | "agree";

const MOVE_INSTRUCTION: Record<BuyerMove, string> = {
  push: "若手は「どれを外すの？」に答えようとしています。まだ準備が足りない答えとして受け止め、棚の事情から1点だけ詰めてください。どの品を外せばよいかの答えを教えない。品名を挙げない。受け入れない。accepted は false。",
  refuse:
    "若手が準備した1本目の返しを言いました。どんなに筋が良くても、今回は受けずに断ってください。断る理由は、棚の事情の中から店の言葉で1つだけ言う。「どれを外すの」とは聞き直さない。次の案を促すかどうかは任せる。accepted は false。",
  hold: "若手の言葉は、どの品をどうするかがまだ具体的ではありません。受け入れず、どの品をどうするのかを短く聞き返してください。accepted は false。",
  agree:
    "若手が2本目の返しを言いました。この案なら受けられます。若手が言った線の範囲で「それなら」と合意し、確認したい条件を1つだけ付けてください。若手が言っていない数字や条件を足さない。accepted は true。",
};

// Claude の立場が段階とずれたときの固定文（文面が2回ずれた場合だけ使う）
const MOVE_FALLBACK: Record<BuyerMove, string> = {
  push: "それだと棚のどこが空くのか見えません。",
  refuse: "その案のままでは受けられません。店の作業が増えるのに、売れる根拠がまだ見えないです。",
  hold: "どの品を、どうするという話ですか。",
  agree: "それなら、その線で検討します。社内で確認してから、もう一度持ってきてください。",
};

const StagedSchema = z.object({ reply: z.string(), accepted: z.boolean() });

// avoid：若手がまだ口にしていない棚の品名。問いの段階でバイヤーが答えを先に言わないようにする
export async function buyerStaged(apiKey: string, turns: Turn[], persona: string, shelfNotes: string, move: BuyerMove, avoid: string[] = []): Promise<string> {
  const history = turns[0]?.role === "buyer" ? turns.slice(1) : turns;
  const stage = `## 棚の事情（あなただけが知っていること）\n${shelfNotes}\n\n粗利の数字や改廃の予定は、そのまま口に出さない。\n\n## 今の段階\n${MOVE_INSTRUCTION[move]}\n\nreply には発言の中身だけを書く。`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await client(apiKey).beta.messages.parse({
      model: MODEL,
      max_tokens: 2000,
      ...FALLBACK,
      output_config: { effort: "low", format: zodOutputFormat(StagedSchema) },
      system: [
        { type: "text", text: BUYER_SYSTEM, cache_control: { type: "ephemeral" } },
        { type: "text", text: persona },
        { type: "text", text: stage },
      ],
      messages: toMessages(history),
    });
    const out = res.parsed_output;
    if (res.stop_reason === "refusal" || !out) throw new Error("バイヤー役の応答が得られませんでした");
    const repeated = move !== "push" && out.reply.includes("どれを外す");
    const leaked = avoid.some((n) => out.reply.includes(n));
    if (out.reply.trim() && out.accepted === (move === "agree") && !repeated && !leaked) return out.reply.trim();
  }
  return MOVE_FALLBACK[move];
}

// 選ぶ係：カードを全部渡すと、どの場面にも当てはまるチェックリストとして使われてしまう。
// 「効く条件」がこの記録に当てはまるカードだけを先に選び、確かめる係と次を決める係にはそれだけを渡す
const SelectSchema = z.object({ picks: z.array(z.object({ caseId: z.string(), why: z.string() })) });
const MAX_PICKS = 3;

const SELECT_SYSTEM = `あなたは商談練習の「カードを選ぶ係」です。練習の記録を読み、ベテランの判断の記録（ケースカード）のうち、この記録の場面に当てはまるものだけを選びます。

## 選び方
- 各カードの appliesWhen（効く条件）が、この記録の中で実際に起きているかで判断する。練習の記録と取引先の記録のどちらにも手がかり（相手の言葉・提案の種類・相手の事情）が無いものは選ばない。
- 「どんな商談にも言える」という理由では選ばない。
- 最大${MAX_PICKS}枚。当てはまるものが無ければ、picks は空にする。
- why には、記録のどの発言・どの事情が効く条件に当たるかを1文で書く。日本語。`;

export async function selectCards(apiKey: string, turns: Turn[], cards: CaseCard[], record = ""): Promise<CaseCard[]> {
  if (cards.length === 0) return [];
  const transcript = turns.map((t) => `${t.role === "rep" ? "若手" : "バイヤー"}：${t.content}`).join("\n");
  const index = cards.map(({ id, scene, appliesWhen, situation }) => ({ id, scene, appliesWhen, situation }));
  const res = await client(apiKey).beta.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    ...FALLBACK,
    output_config: { effort: "low", format: zodOutputFormat(SelectSchema) },
    system: [{ type: "text", text: SELECT_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `## ケースカード\n${JSON.stringify(index, null, 2)}${recordBlock(record)}\n\n## 練習の記録\n${transcript}` }],
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
- 取引先の記録があるときは、そこにある相手の「今大事にしていること」や「次回の約束」を若手が踏まえたかも見る。
- 点数・順位・総合評価は出さない。人を評価する言葉（優秀、未熟など）を使わない。
- 1項目は1文。日本語。`;

export async function check(apiKey: string, turns: Turn[], memo: string, cards: CaseCard[], record = ""): Promise<CheckResult> {
  const transcript = turns.map((t) => `${t.role === "rep" ? "若手" : "バイヤー"}：${t.content}`).join("\n");
  const res = await client(apiKey).beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: "high", format: zodOutputFormat(CheckSchema) },
    system: [{ type: "text", text: checkSystem(cards), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `## 練習の記録\n${transcript}\n\n## 3分メモ\n${memo || "（未記入）"}${recordBlock(record)}` }],
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
- 取引先の記録があるときは、相手の「今大事にしていること」に結びつく形で一行動を書く。
- 練習の記録でバイヤーが反発した場面に結びつくものを優先する（本人が手応えとして覚えている所から直す）。
- 次の練習1回でできる大きさにする。「お客様理解を深める」のような広い言葉にしない。
- caseId には、その行動の手本になるケースカードの id を1つ入れる。当てはまるものが無ければ空にする。
- tryLine には、次の練習でそのまま口に出せる一言を書く（例：「どこが同じに見えましたか？」）。
- reason は1文。なぜ今これなのかを、記録の場面に触れて書く。
- 点数・人を評価する言葉は使わない。日本語。`;

export async function decideNext(apiKey: string, turns: Turn[], result: CheckResult, cards: CaseCard[], record = ""): Promise<NextAction> {
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
        content: `## 練習の記録\n${transcript}\n\n## 確かめる係の結果\n${JSON.stringify(result.axes, null, 2)}${recordBlock(record)}`,
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

// 議事録の下書き：文字起こしから、要約・決定事項・残った論点・次回の約束・今大事にしていることの候補を抜き出す（確定は人）
const MinutesSchema = z.object({
  summary: z.string(),
  decisions: z.array(z.string()),
  openIssues: z.array(z.string()),
  promises: z.array(z.object({ text: z.string(), due: z.string() })),
  priorities: z.array(z.object({ text: z.string(), basis: z.string() })),
});
export type MinutesDraft = z.infer<typeof MinutesSchema>;

const MINUTES_SYSTEM = `あなたは商談の議事録の下書きを作る係です。文字起こしを読み、次の項目を埋めます。確定するのは人です。

## 書き方の決まり
- 文字起こしに書かれていることだけを使う。推測で埋めない。無い項目は空にする。
- summary は2〜3文。何の商談で、どうなったか。
- decisions は、双方が合意して決まったことだけ。提案しただけのものは入れない。
- openIssues は、結論が出ずに残った論点。
- promises は、次回までにどちらかがやると言ったこと。due は発言に期日があれば書き、無ければ空にする。
- priorities は、バイヤーが今大事にしていること（売上・粗利・在庫・作業の負担・客層など）。basis にはバイヤーの発言をそのまま引く。バイヤーの発言に根拠が無いものは書かない。
- 日本語。人を評価する言葉を使わない。`;

export async function draftMinutes(apiKey: string, turns: Turn[]): Promise<MinutesDraft> {
  const transcript = turns.map((t) => `${t.role === "rep" ? "営業" : "バイヤー"}：${t.content}`).join("\n");
  const res = await client(apiKey).beta.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    ...FALLBACK,
    output_config: { effort: "medium", format: zodOutputFormat(MinutesSchema) },
    system: [{ type: "text", text: MINUTES_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `## 文字起こし\n${transcript}` }],
  });
  const out = res.parsed_output;
  if (res.stop_reason === "refusal" || !out) throw new Error("議事録の下書きを作れませんでした");
  // 根拠の引用が相手の発言に無いものは落とす
  const said = turns.filter((t) => t.role === "buyer").map((t) => t.content).join("\n");
  return { ...out, priorities: out.priorities.filter((p) => p.basis.trim() !== "" && said.includes(p.basis.trim())) };
}

// 相談文を書く係：返しと落としどころを、商談前に上司へ確かめる1枚にする。決めるのは上司。
// 入力は4つだけ。練習の発言・5軸・次の一行動は渡さない
const ConsultSchema = z.object({
  summary: z.string(),
  concessions: z.array(z.string()),
  asks: z.array(z.string()),
});

export type ConsultInput = {
  gainAnswer: string;
  returns: string[];
  landing: string;
  candidates: { name: string; maker: string; is_own: number; facings: number; weekly_units: number; yoy_pct: number }[];
};
export type ConsultDraft = z.infer<typeof ConsultSchema>;

const CONSULT_SYSTEM = `あなたは若手営業が上司に渡す相談文を下書きする係です。商談の前に「ここまで譲ってよいか」を上司に確かめるための文です。

## 書き方の決まり
- 入力に書かれていることだけを使う。入力に無い数字・品名・条件を足さない。
- summary：何を相談したいかを2文以内で。
- concessions：入力の返しと同じ順番で、1本につき1文、その返しで自社が譲るものを書く。譲るものが読み取れなければ「確かめが要る」とだけ書く。「入力」という言葉を文に出さない。
- asks：上司に確かめたいことを2〜3個、「〜してよいでしょうか」の形で書く。自社品を外す案があれば、必ず1つ入れる。
- 決めるのは上司。勧める・決めつける言い方をしない。
- 人を評価する言葉を使わない。日本語。`;

// 入力に無い数字を含む文は採らない（数字は Claude に作らせない）
const numbersIn = (s: string) => s.match(/\d+/g) ?? [];
const knownNumbersOnly = (s: string, known: Set<string>) =>
  s.split(/(?<=。)/).filter((sentence) => numbersIn(sentence).every((n) => known.has(n))).join("");

export async function writeConsult(apiKey: string, input: ConsultInput): Promise<ConsultDraft> {
  const body = JSON.stringify(input, null, 2);
  const res = await client(apiKey).beta.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    ...FALLBACK,
    output_config: { effort: "low", format: zodOutputFormat(ConsultSchema) },
    system: [{ type: "text", text: CONSULT_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `## 入力\n${body}` }],
  });
  const out = res.parsed_output;
  if (res.stop_reason === "refusal" || !out) throw new Error("相談文を書く係の応答が得られませんでした");
  const known = new Set(numbersIn(body));
  return {
    summary: knownNumbersOnly(out.summary, known),
    concessions: input.returns.map((_, i) => knownNumbersOnly(out.concessions[i] ?? "", known) || "確かめが要る"),
    asks: out.asks.map((a) => knownNumbersOnly(a, known)).filter(Boolean),
  };
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
