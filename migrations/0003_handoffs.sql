-- 担当の引き継ぎ書。Managed Agents のセッションが書き、別の採点係が合格を出すまで直す
CREATE TABLE handoffs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  from_rep TEXT NOT NULL,
  to_rep TEXT NOT NULL,
  session_id TEXT NOT NULL,      -- Managed Agents のセッション
  labels_json TEXT NOT NULL,     -- M1・P1・T1 の根拠ラベルと、記録の id の対応
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'passed', 'unpassed', 'failed')),
  content TEXT NOT NULL DEFAULT '',
  evaluations_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 架空の見本データ：ベテランが担当してきたコモレビマートの記録（実在の企業・人物とは関係ありません）
INSERT INTO meetings (id, account_id, buyer_id, held_on, kind, participants, summary, decisions_json, open_issues_json, status) VALUES
  ('mtg-taka-0415', 'acc-komorebi', 'buyer-takatori', '2026-04-15', '定例商談', '高取（架空）／ベテラン（架空）',
   '今年は若い家族の来店を増やす方針と聞いた。5月のチラシは値引きの品を増やして集客したいとのこと。',
   '["5月のチラシに値引きの飲料を2品出す"]', '[]', 'confirmed'),
  ('mtg-taka-0617', 'acc-komorebi', 'buyer-takatori', '2026-06-17', '定例商談', '高取（架空）／ベテラン（架空）',
   '5月のチラシの値引き品はよく売れたが、粗利が残らず店長会で問題になった。値引きで人を集める進め方はやめるとのこと。',
   '["今後のチラシ企画は、粗利の試算を付けて出す"]', '["若い家族向けの売場をどう作るか"]', 'confirmed'),
  ('mtg-taka-0826', 'acc-komorebi', 'buyer-takatori', '2026-08-26', '企画の相談', '高取（架空）／ベテラン（架空）',
   '親子向けの飲料の売場を提案した。まず2店舗で試すことになった。',
   '["9月に2店舗で親子向けの売場を試す"]', '[]', 'confirmed'),
  ('mtg-taka-1014', 'acc-komorebi', 'buyer-takatori', '2026-10-14', '定例商談', '高取（架空）／ベテラン（架空）',
   '2店舗の試験は客数も粗利も前年より良かった。12月のチラシに載せる方向で、店長会の前に数字を見たいと言われた。',
   '["12月のチラシの掲載を目指して試算を出す"]', '["1月の定番棚の入れ替えは未定"]', 'confirmed');

INSERT INTO priorities (id, buyer_id, meeting_id, text, basis, noted_on, status) VALUES
  ('pri-taka-discount', 'buyer-takatori', 'mtg-taka-0415', 'チラシの値引きで集客する', '「5月は値引きの品を増やして、とにかく人を呼びたい」', '2026-04-15', 'approved'),
  ('pri-taka-margin', 'buyer-takatori', 'mtg-taka-0617', 'チラシの企画に粗利の裏付けがあること', '「売れても粗利が残らないと、店長会を通りません」', '2026-06-17', 'approved'),
  ('pri-taka-family', 'buyer-takatori', 'mtg-taka-0826', '若い家族が買いに来る売場', '「親子で来る人を増やしたいんです」', '2026-08-26', 'approved'),
  ('pri-taka-store', 'buyer-takatori', 'mtg-taka-1014', '店長に説明しやすい資料', '「店長に一言で言える形だと助かります」', '2026-10-14', 'pending');

INSERT INTO promises (id, meeting_id, text, due, done) VALUES
  ('prm-taka-trial', 'mtg-taka-0826', '2店舗の試験の結果をまとめて報告する', '2026-09-30', 1),
  ('prm-taka-margin', 'mtg-taka-1014', '12月のチラシの粗利の試算を高取さんに出す', '2026-11-06', 0),
  ('prm-taka-shelf', 'mtg-taka-1014', '1月の定番棚の入れ替え案を持っていく', '', 0);
