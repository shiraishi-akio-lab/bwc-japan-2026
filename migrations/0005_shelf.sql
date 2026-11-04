-- 架空の棚データ。若手に見える列は shelf_items、バイヤーだけが知っている列は shelf_buyer_notes に分ける
CREATE TABLE shelf_items (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,        -- 会話の中で呼ぶ名前
  maker TEXT NOT NULL,
  is_own INTEGER NOT NULL DEFAULT 0, -- 自社品
  is_pb INTEGER NOT NULL DEFAULT 0,  -- 小売の自社ブランド
  facings INTEGER NOT NULL,        -- 棚の列数
  weekly_units INTEGER NOT NULL,   -- 1店あたりの週販（本）
  yoy_pct INTEGER NOT NULL         -- 前年比（%）
);

-- 画面と API には返さない。読むのはバイヤー役だけ
CREATE TABLE shelf_buyer_notes (
  item_id TEXT PRIMARY KEY REFERENCES shelf_items(id),
  gross_margin_pct INTEGER NOT NULL,
  delist_plan TEXT NOT NULL,
  note TEXT NOT NULL
);

-- 架空の見本データ（実在の企業・商品とは関係ありません）
INSERT INTO shelf_items (id, account_id, name, short_name, maker, is_own, is_pb, facings, weekly_units, yoy_pct) VALUES
  ('shelf-pb-sparkling', 'acc-harukaze', 'ハルカゼ 無糖炭酸水 500ml（架空）', '無糖炭酸水', 'ハルカゼドラッグ（架空）', 0, 1, 4, 96, 104),
  ('shelf-cola-zero', 'acc-harukaze', 'シラカバ コーラゼロ 500ml（架空）', 'コーラゼロ', 'シラカバ飲料（架空）', 0, 0, 3, 58, 99),
  ('shelf-yuzu', 'acc-harukaze', 'ミズナギ ゆず炭酸 500ml（架空）', 'ゆず炭酸', 'ミズナギ飲料（架空）', 1, 0, 2, 31, 97),
  ('shelf-strong', 'acc-harukaze', 'シラカバ 強炭酸 500ml（架空）', '強炭酸', 'シラカバ飲料（架空）', 0, 0, 3, 72, 101),
  ('shelf-mulemon', 'acc-harukaze', 'アオミネ 無糖レモン 500ml（架空）', '無糖レモン', 'アオミネ飲料（架空）', 0, 0, 2, 22, 92),
  ('shelf-shiolemon', 'acc-harukaze', 'ミズナギ 塩レモン炭酸 500ml（架空）', '塩レモン炭酸', 'ミズナギ飲料（架空）', 1, 0, 2, 14, 88),
  ('shelf-ginger', 'acc-harukaze', 'アオミネ ジンジャーエール 500ml（架空）', 'ジンジャーエール', 'アオミネ飲料（架空）', 0, 0, 2, 18, 95);

INSERT INTO shelf_buyer_notes (item_id, gross_margin_pct, delist_plan, note) VALUES
  ('shelf-pb-sparkling', 38, '外さない', 'PB は今年の粗利の柱。この列数は社内で決まっている。'),
  ('shelf-cola-zero', 23, '残す', '来店の目的になる定番。'),
  ('shelf-yuzu', 26, '残す', '夏場に動く。冬の数字だけで判断したくない。'),
  ('shelf-strong', 24, '残す', '健康の売場づくりで前に出したい。'),
  ('shelf-mulemon', 25, '様子見', 'アオミネの営業から3月に新しい味の提案が来る予定。'),
  ('shelf-shiolemon', 21, '3月の改廃の第一候補', '店からも動かないと言われている。新しい品に替えて売れる根拠が無いと、全店で一度に替える気にはなれない。'),
  ('shelf-ginger', 22, '様子見', '減ってはいるが、固定客がいて問い合わせが来る。');
