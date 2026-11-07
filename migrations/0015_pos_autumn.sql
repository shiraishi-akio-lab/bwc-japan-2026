-- 秋の棚割り改定の前後を比べるため、改定の日と、改定前の4週を足す（架空の見本データ）。改定後の4週は recent の最初の4週を使う
ALTER TABLE pos_sources ADD COLUMN autumn_on TEXT NOT NULL DEFAULT '2026-09-07';

INSERT INTO pos_weekly (account_id, item_id, period, week_on, units, ly_units) VALUES
  ('acc-harukaze', '', 'revision', '2026-08-10', 324, NULL),
  ('acc-harukaze', '', 'revision', '2026-08-17', 325, NULL),
  ('acc-harukaze', '', 'revision', '2026-08-24', 324, NULL),
  ('acc-harukaze', '', 'revision', '2026-08-31', 323, NULL),
  ('acc-harukaze', 'shelf-shiolemon', 'revision', '2026-08-10', 17, NULL),
  ('acc-harukaze', 'shelf-shiolemon', 'revision', '2026-08-17', 17, NULL),
  ('acc-harukaze', 'shelf-shiolemon', 'revision', '2026-08-24', 16, NULL),
  ('acc-harukaze', 'shelf-shiolemon', 'revision', '2026-08-31', 16, NULL),
  ('acc-harukaze', 'shelf-yuzu', 'revision', '2026-08-10', 33, NULL),
  ('acc-harukaze', 'shelf-yuzu', 'revision', '2026-08-17', 33, NULL),
  ('acc-harukaze', 'shelf-yuzu', 'revision', '2026-08-24', 34, NULL),
  ('acc-harukaze', 'shelf-yuzu', 'revision', '2026-08-31', 34, NULL);
