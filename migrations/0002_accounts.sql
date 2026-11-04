-- 取引先の記録：どの記録も取引先と担当バイヤーに紐づける。AI が読むのは人が確定したものだけ
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  format TEXT NOT NULL,          -- 業態
  stores INTEGER NOT NULL,       -- 店舗数
  profile TEXT NOT NULL,         -- 会社の概要と今年の方針
  rules TEXT NOT NULL,           -- この会社の決まりごと（棚割りの時期など）
  owner_rep TEXT NOT NULL,       -- こちらの担当営業
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE buyers (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '現役' CHECK (status IN ('現役', '異動', '退職')),
  persona TEXT NOT NULL,         -- バイヤー役だけが知っていること（若手には見せない）
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 商談の記録と議事録（1件に1つ）。draft は下書き、confirmed は人が直して確定したもの
CREATE TABLE meetings (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  buyer_id TEXT NOT NULL REFERENCES buyers(id),
  session_id TEXT REFERENCES practice_sessions(id),
  held_on TEXT NOT NULL,
  kind TEXT NOT NULL,
  participants TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  decisions_json TEXT NOT NULL DEFAULT '[]',
  open_issues_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 今大事にしていること。pending は候補、approved になって初めて AI が読む
CREATE TABLE priorities (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL REFERENCES buyers(id),
  meeting_id TEXT REFERENCES meetings(id),
  text TEXT NOT NULL,
  basis TEXT NOT NULL,           -- 読み取った根拠（相手の言葉）
  noted_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 次回の約束
CREATE TABLE promises (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings(id),
  text TEXT NOT NULL,
  due TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE practice_sessions ADD COLUMN buyer_id TEXT REFERENCES buyers(id);
ALTER TABLE practice_sessions ADD COLUMN use_record INTEGER NOT NULL DEFAULT 1;

-- 架空の見本データ（実在の企業・人物とは関係ありません）
INSERT INTO accounts (id, name, format, stores, profile, rules, owner_rep) VALUES
  ('acc-harukaze', 'ハルカゼドラッグ（架空）', 'ドラッグストア', 32,
   '同じ地方に32店舗のドラッグストアチェーン。食品・飲料の売上比率を上げる方針。今年は来店頻度を上げる、健康を軸にした売場づくり、PB の粗利を守る。店舗は少人数で回している。',
   '飲料の棚割り改定は年2回（3月・9月）で、決めるのは2か月前まで。冷蔵ケースは別枠で入れ替えのハードルが高い。',
   '森川（架空）'),
  ('acc-komorebi', 'コモレビマート（架空）', '食品スーパー', 14,
   '郊外に14店舗の食品スーパー。地元の生鮮に強い。今年は若い家族の来店を増やしたい。',
   '月1回のチラシが売上の柱で、掲載商品は6週間前に決まる。新商品の採用は店長会の前に決める。',
   'ベテラン（架空）');

INSERT INTO buyers (id, account_id, name, role, status, persona) VALUES
  ('buyer-saeki', 'acc-harukaze', '佐伯（架空）', '食品・飲料カテゴリのバイヤー', '現役',
   '飲料の棚で動きの悪い商品が2〜3品ある（入れ替え候補）。次の棚割り改定は3月。今年は健康を軸にした売場で来店頻度を上げたい。PB の無糖炭酸の粗利は守りたく、PB と正面から並ぶ提案は通しにくい。店は少人数で、作業が増える売場替えは断る。他社からも夏の値引き企画を受けている。忙しく、数字と店頭の負担で判断する。'),
  ('buyer-asano', 'acc-harukaze', '浅野（架空）', '前任の飲料バイヤー（2026年春に異動）', '異動',
   '商品部から店舗運営部に異動した。今は飲料の仕入れを決める立場ではない。'),
  ('buyer-takatori', 'acc-komorebi', '高取（架空）', '加工食品・飲料のバイヤー', '現役',
   'チラシの掲載枠は売上の柱で、枠を取るには粗利の裏付けが要る。若い家族向けの品ぞろえを増やしたいが、定番の棚は埋まっている。地元の商品には好意的。話は丁寧だが、結論は店長会の前まで出さない。');

INSERT INTO meetings (id, account_id, buyer_id, held_on, kind, participants, summary, decisions_json, open_issues_json, status) VALUES
  ('mtg-saeki-0910', 'acc-harukaze', 'buyer-saeki', '2026-09-10', '定例商談', '佐伯（架空）／森川（架空）',
   '秋の棚割りの結果の確認。夏の季節飲料が8月から伸びず、飲料全体で前年を下回っている。',
   '["秋の販促は値引きではなく、売場の見直しを先に話す"]',
   '["3月の棚割りで入れ替える候補の品目は未確認"]', 'confirmed'),
  ('mtg-asano-0312', 'acc-harukaze', 'buyer-asano', '2026-03-12', '引き継ぎ', '浅野（架空）／ベテラン（架空）／森川（架空）',
   '担当バイヤーが浅野から佐伯に替わる前の最後の商談。PB の無糖炭酸を守る方針は変わらないと聞いた。',
   '["後任の佐伯へ、PB とぶつからない提案から入る"]',
   '[]', 'confirmed');

INSERT INTO priorities (id, buyer_id, meeting_id, text, basis, noted_on, status) VALUES
  ('pri-saeki-sales', 'buyer-saeki', 'mtg-saeki-0910', '夏の季節飲料の落ち込みを埋める売上の回復', '「8月から季節ものが全然動かない。とにかく売上を戻したい」', '2026-09-10', 'approved');

INSERT INTO promises (id, meeting_id, text, due) VALUES
  ('prm-saeki-1', 'mtg-saeki-0910', '3月の棚割りに向けて、入れ替え候補の品目を確認する', '2026-11-30');
