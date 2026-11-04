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

export const loadShelf = async (db: D1Database, accountId: string): Promise<ShelfItem[]> => {
  const { results } = await db
    .prepare("SELECT id, name, short_name, maker, is_own, is_pb, facings, weekly_units, yoy_pct FROM shelf_items WHERE account_id = ?")
    .bind(accountId)
    .all<ShelfItem>();
  return results;
};

// バイヤー役だけに渡す。API の応答に混ぜない
export const buyerShelfNotes = async (db: D1Database, accountId: string): Promise<string> => {
  const { results } = await db
    .prepare(
      `SELECT s.name, s.facings, s.weekly_units, n.gross_margin_pct, n.delist_plan, n.note
       FROM shelf_items s JOIN shelf_buyer_notes n ON n.item_id = s.id WHERE s.account_id = ?`,
    )
    .bind(accountId)
    .all<{ name: string; facings: number; weekly_units: number; gross_margin_pct: number; delist_plan: string; note: string }>();
  return results.map((r) => `- ${r.name}：${r.facings}列・週販${r.weekly_units}本・粗利${r.gross_margin_pct}%・${r.delist_plan}・${r.note}`).join("\n");
};
