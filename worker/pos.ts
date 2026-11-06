// 店頭の販売実績（POS）。見せるのは売場全体と自社品だけ。他社品は表に行があっても読まない。
// 平均と前年比はここで計算する（Claude に数字を作らせない）。Claude への入力には渡さない
export type PosWeek = { week_on: string; units: number; ly_units: number };
export type PosSeries = {
  id: string; name: string; own: boolean; weeks: PosWeek[]; avg_units: number; yoy_pct: number;
  before_units: number; after_units: number;
};
export type Pos = {
  title: string; fetched_on: string; revised_on: string; from_on: string; to_on: string;
  before_from: string; before_to: string; after_from: string; after_to: string; series: PosSeries[];
};

type Row = { item_id: string; period: "recent" | "revision"; week_on: string; units: number; ly_units: number | null; short_name: string | null };

const RECENT_WEEKS = 8;
const REVISION_WEEKS = 4;
const DAY = 86_400_000;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => Math.round(sum(xs) / xs.length);
const lastDay = (monday: string) => new Date(Date.parse(monday) + 6 * DAY).toISOString().slice(0, 10);

// 商談日までに終わった週だけを使う。8週そろわなければ出さない（商談日より後の数字を見せない）
export async function loadPos(db: D1Database, accountId: string, meetingOn: string): Promise<Pos | null> {
  const source = await db.prepare("SELECT title, fetched_on, revised_on FROM pos_sources WHERE account_id = ?")
    .bind(accountId).first<{ title: string; fetched_on: string; revised_on: string }>();
  if (!source) return null;
  const { results } = await db.prepare(
    `SELECT p.item_id, p.period, p.week_on, p.units, p.ly_units, s.short_name FROM pos_weekly p
     LEFT JOIN shelf_items s ON s.id = p.item_id AND s.account_id = p.account_id
     WHERE p.account_id = ? AND date(p.week_on, '+6 days') <= ? AND (p.item_id = '' OR s.is_own = 1) ORDER BY p.item_id, p.week_on`,
  ).bind(accountId, meetingOn).all<Row>();

  const around = (rows: Row[]) => {
    const revision = rows.filter((r) => r.period === "revision");
    return {
      before: revision.filter((r) => r.week_on < source.revised_on).slice(-REVISION_WEEKS),
      after: revision.filter((r) => r.week_on >= source.revised_on).slice(0, REVISION_WEEKS),
    };
  };
  const series: PosSeries[] = [];
  for (const id of new Set(results.map((r) => r.item_id))) {
    const rows = results.filter((r) => r.item_id === id);
    const recent = rows.filter((r) => r.period === "recent" && r.ly_units !== null).slice(-RECENT_WEEKS);
    const { before, after } = around(rows);
    if (recent.length < RECENT_WEEKS || before.length < REVISION_WEEKS || after.length < REVISION_WEEKS) return null;
    const weeks = recent.map(({ week_on, units, ly_units }) => ({ week_on, units, ly_units: ly_units! }));
    series.push({
      id, name: rows[0].short_name ?? "", own: id !== "", weeks,
      avg_units: mean(weeks.map((w) => w.units)),
      yoy_pct: Math.round((sum(weeks.map((w) => w.units)) / sum(weeks.map((w) => w.ly_units))) * 100),
      before_units: mean(before.map((r) => r.units)),
      after_units: mean(after.map((r) => r.units)),
    });
  }
  if (series.length === 0) return null;
  const { before, after } = around(results.filter((r) => r.item_id === series[0].id));
  const weeks = series[0].weeks;
  return {
    ...source,
    from_on: weeks[0].week_on,
    to_on: lastDay(weeks[weeks.length - 1].week_on),
    before_from: before[0].week_on,
    before_to: lastDay(before[before.length - 1].week_on),
    after_from: after[0].week_on,
    after_to: lastDay(after[after.length - 1].week_on),
    series,
  };
}
