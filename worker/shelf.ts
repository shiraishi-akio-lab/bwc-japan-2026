// 棚データ。若手に見える列だけを返す関数と、バイヤー役に渡す文を分ける
export type ShelfItem = {
  id: string; name: string; short_name: string; maker: string;
  is_own: number; is_pb: number; facings: number; weekly_units: number; yoy_pct: number;
};

const MAX_CANDIDATES = 5;

// 候補はコードで並べる（Claude に作らせない）。週販の低い順、同じなら前年比の低い順。
// 小売の自社ブランドは若手が外すと言える品ではないので、候補に入れない
export const shelfCandidates = (items: ShelfItem[]): ShelfItem[] =>
  items
    .filter((i) => !i.is_pb)
    .sort((a, b) => a.weekly_units - b.weekly_units || a.yoy_pct - b.yoy_pct || a.id.localeCompare(b.id))
    .slice(0, MAX_CANDIDATES);

const normalize = (s: string) => s.replace(/[\s、。，．,.！？!?「」『』（）()・]/g, "");
const bigrams = (s: string) => new Set(Array.from({ length: Math.max(s.length - 1, 0) }, (_, i) => s.slice(i, i + 2)));

// 用意した文のうち、発言に出てきた2文字の割合
const overlap = (said: string, prepared: string) => {
  const target = bigrams(normalize(prepared));
  if (target.size === 0) return 0;
  const heard = bigrams(normalize(said));
  return [...target].filter((b) => heard.has(b)).length / target.size;
};

const MIN_OVERLAP = 0.5;
const TRIAL_WORDS = /試す|試して|試し|期間を|期間限定/;
const NOT_A_RETURN = /値引|割引|安く|しません|ません|外さな|試さな|つもりはな/;

// バイヤー役が2本目で合意する条件：棚の品を名指ししている／試す線を出している／用意した返しか落としどころを言っている。
// 値引きのお願い、否定、準備の無い一言、この回で断られた案の言い直しでは合意しない。
// shortNames には若手が外すと言える品だけを渡す（PB は入れない）
export const agreementCondition = (said: string, shortNames: string[], returns: string[], landing: string, saidThisRound: string[] = []): boolean =>
  !NOT_A_RETURN.test(said) &&
  !saidThisRound.some((t) => overlap(said, t) >= MIN_OVERLAP) &&
  (shortNames.some((n) => said.includes(n)) ||
    TRIAL_WORDS.test(said) ||
    [...returns, landing].some((t) => overlap(said, t) >= MIN_OVERLAP));

export const loadShelf = async (db: D1Database, accountId: string): Promise<ShelfItem[]> => {
  const { results } = await db
    .prepare("SELECT id, name, short_name, maker, is_own, is_pb, facings, weekly_units, yoy_pct FROM shelf_items WHERE account_id = ?")
    .bind(accountId)
    .all<ShelfItem>();
  return results;
};

// バイヤー役だけに渡す。API の応答に混ぜない
export const buyerShelfNotes = async (db: D1Database, accountId: string): Promise<{ text: string; secrets: string[] }> => {
  const { results } = await db
    .prepare(
      `SELECT s.name, s.facings, s.weekly_units, n.gross_margin_pct, n.delist_plan, n.note
       FROM shelf_items s JOIN shelf_buyer_notes n ON n.item_id = s.id WHERE s.account_id = ?`,
    )
    .bind(accountId)
    .all<{ name: string; facings: number; weekly_units: number; gross_margin_pct: number; delist_plan: string; note: string }>();
  return {
    text: results.map((r) => `- ${r.name}：${r.facings}列・週販${r.weekly_units}本・粗利${r.gross_margin_pct}%・${r.delist_plan}・${r.note}`).join("\n"),
    // バイヤー役の発言に出たら採らない語
    secrets: ["第一候補", "改廃", ...results.map((r) => `${r.gross_margin_pct}%`)],
  };
};
