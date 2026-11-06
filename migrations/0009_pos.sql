-- 店頭の販売実績（POS）。下調べと相手の情報に出す。品名まで持つのは自社品だけで、他社品の行は作らない（棚の表は問いのあと）
-- 会社の範囲は shelf_items と同じく accounts.company_id からたどる
CREATE TABLE pos_sources (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  title TEXT NOT NULL,                -- 出どころ
  fetched_on TEXT NOT NULL,           -- 取得日
  revised_on TEXT NOT NULL            -- 前年の3月の棚割り改定の日。この日より前と後で4週ずつ比べる
);

CREATE TABLE pos_weekly (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  item_id TEXT NOT NULL DEFAULT '',   -- shelf_items の id。空は売場全体（この取引先の棚の全品の合計）
  period TEXT NOT NULL CHECK (period IN ('recent', 'revision')), -- 直近8週／前年の改定の前後
  week_on TEXT NOT NULL,              -- 週の始まりの月曜
  units INTEGER NOT NULL,             -- 1店あたりの週販（本）
  ly_units INTEGER,                   -- 前年の同じ週（recent だけ）
  PRIMARY KEY (account_id, item_id, week_on)
);

-- 架空の見本データ（実在の企業・商品とは関係ありません）
-- 棚の表（0005）とつなげてある：直近8週の平均は weekly_units、前年比は yoy_pct と一致する。売場全体は棚の7品の週販の合計（311本）
INSERT INTO pos_sources (account_id, title, fetched_on, revised_on) VALUES
  ('acc-harukaze', 'ハルカゼドラッグのPOS（架空の見本データ）', '2026-11-02', '2026-03-02');

INSERT INTO pos_weekly (account_id, item_id, period, week_on, units, ly_units) VALUES
  ('acc-harukaze', '', 'recent', '2026-09-07', 322, 323),
  ('acc-harukaze', '', 'recent', '2026-09-14', 318, 320),
  ('acc-harukaze', '', 'recent', '2026-09-21', 315, 317),
  ('acc-harukaze', '', 'recent', '2026-09-28', 312, 314),
  ('acc-harukaze', '', 'recent', '2026-10-05', 310, 312),
  ('acc-harukaze', '', 'recent', '2026-10-12', 307, 309),
  ('acc-harukaze', '', 'recent', '2026-10-19', 304, 306),
  ('acc-harukaze', '', 'recent', '2026-10-26', 300, 302),
  ('acc-harukaze', '', 'revision', '2026-02-02', 294, NULL),
  ('acc-harukaze', '', 'revision', '2026-02-09', 296, NULL),
  ('acc-harukaze', '', 'revision', '2026-02-16', 298, NULL),
  ('acc-harukaze', '', 'revision', '2026-02-23', 300, NULL),
  ('acc-harukaze', '', 'revision', '2026-03-02', 310, NULL),
  ('acc-harukaze', '', 'revision', '2026-03-09', 318, NULL),
  ('acc-harukaze', '', 'revision', '2026-03-16', 322, NULL),
  ('acc-harukaze', '', 'revision', '2026-03-23', 326, NULL),
  ('acc-harukaze', 'shelf-shiolemon', 'recent', '2026-09-07', 15, 17),
  ('acc-harukaze', 'shelf-shiolemon', 'recent', '2026-09-14', 15, 16),
  ('acc-harukaze', 'shelf-shiolemon', 'recent', '2026-09-21', 14, 16),
  ('acc-harukaze', 'shelf-shiolemon', 'recent', '2026-09-28', 14, 16),
  ('acc-harukaze', 'shelf-shiolemon', 'recent', '2026-10-05', 14, 16),
  ('acc-harukaze', 'shelf-shiolemon', 'recent', '2026-10-12', 14, 16),
  ('acc-harukaze', 'shelf-shiolemon', 'recent', '2026-10-19', 13, 15),
  ('acc-harukaze', 'shelf-shiolemon', 'recent', '2026-10-26', 13, 15),
  ('acc-harukaze', 'shelf-shiolemon', 'revision', '2026-02-02', 17, NULL),
  ('acc-harukaze', 'shelf-shiolemon', 'revision', '2026-02-09', 16, NULL),
  ('acc-harukaze', 'shelf-shiolemon', 'revision', '2026-02-16', 16, NULL),
  ('acc-harukaze', 'shelf-shiolemon', 'revision', '2026-02-23', 15, NULL),
  ('acc-harukaze', 'shelf-shiolemon', 'revision', '2026-03-02', 16, NULL),
  ('acc-harukaze', 'shelf-shiolemon', 'revision', '2026-03-09', 15, NULL),
  ('acc-harukaze', 'shelf-shiolemon', 'revision', '2026-03-16', 15, NULL),
  ('acc-harukaze', 'shelf-shiolemon', 'revision', '2026-03-23', 14, NULL),
  ('acc-harukaze', 'shelf-yuzu', 'recent', '2026-09-07', 34, 35),
  ('acc-harukaze', 'shelf-yuzu', 'recent', '2026-09-14', 33, 34),
  ('acc-harukaze', 'shelf-yuzu', 'recent', '2026-09-21', 32, 33),
  ('acc-harukaze', 'shelf-yuzu', 'recent', '2026-09-28', 31, 32),
  ('acc-harukaze', 'shelf-yuzu', 'recent', '2026-10-05', 31, 32),
  ('acc-harukaze', 'shelf-yuzu', 'recent', '2026-10-12', 30, 31),
  ('acc-harukaze', 'shelf-yuzu', 'recent', '2026-10-19', 29, 30),
  ('acc-harukaze', 'shelf-yuzu', 'recent', '2026-10-26', 28, 29),
  ('acc-harukaze', 'shelf-yuzu', 'revision', '2026-02-02', 27, NULL),
  ('acc-harukaze', 'shelf-yuzu', 'revision', '2026-02-09', 28, NULL),
  ('acc-harukaze', 'shelf-yuzu', 'revision', '2026-02-16', 28, NULL),
  ('acc-harukaze', 'shelf-yuzu', 'revision', '2026-02-23', 29, NULL),
  ('acc-harukaze', 'shelf-yuzu', 'revision', '2026-03-02', 29, NULL),
  ('acc-harukaze', 'shelf-yuzu', 'revision', '2026-03-09', 30, NULL),
  ('acc-harukaze', 'shelf-yuzu', 'revision', '2026-03-16', 31, NULL),
  ('acc-harukaze', 'shelf-yuzu', 'revision', '2026-03-23', 30, NULL);
