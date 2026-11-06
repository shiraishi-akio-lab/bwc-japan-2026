-- 相手の棚：企業の関心（取得して人が承認）・担当者の傾向・ことカレンダー
ALTER TABLE accounts ADD COLUMN site_url TEXT NOT NULL DEFAULT ''; -- 公開情報の入口

-- 公開ページから読んだ関心。pending は候補で、approved になって初めて準備室と AI が読む
CREATE TABLE company_interests (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  text TEXT NOT NULL,
  basis TEXT NOT NULL,                -- 根拠（ページの本文からそのまま）
  theme TEXT NOT NULL,                -- 関心の種類（worker/types.ts）
  source_url TEXT NOT NULL,           -- 出どころ
  source_title TEXT NOT NULL,
  published_on TEXT NOT NULL DEFAULT '', -- ページから読めた日付。読めなければ空
  fetched_on TEXT NOT NULL,           -- 取得した日
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 商談で観察された傾向。確定した商談の分だけを読む。buyers.persona（バイヤー役だけの情報）とは分ける
CREATE TABLE buyer_observations (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL REFERENCES buyers(id),
  meeting_id TEXT NOT NULL REFERENCES meetings(id),
  tendency TEXT NOT NULL,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  basis TEXT NOT NULL,                -- 根拠の発言
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ことカレンダー。行事・投入時期 × 店の動き × 提案内容 × 自社の過去の実績。読むだけ
CREATE TABLE season_events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  month INTEGER NOT NULL,             -- 行事・投入の月日
  day INTEGER NOT NULL,
  deadline_month INTEGER NOT NULL,    -- 提案の締切の目安（行事の月より大きければ前の年）
  deadline_day INTEGER NOT NULL,
  store_action TEXT NOT NULL,         -- 店の動き
  proposal TEXT NOT NULL,             -- 提案内容
  own_result TEXT NOT NULL            -- 自社の過去の実績
);

-- 架空の見本データ（実在の企業・人物とは関係ありません）
UPDATE accounts SET site_url = '/sample-site/harukaze/index.html' WHERE id = 'acc-harukaze';

-- 下書きの商談の分は、確定した記録だけを読むことを確かめるために残す
INSERT INTO buyer_observations (id, buyer_id, meeting_id, tendency, keywords_json, basis) VALUES
  ('obs-saeki-uriba', 'buyer-saeki', 'mtg-saeki-0910', '値引きの話の前に、売場をどう変えるかを尋ねる場面があった', '["売場","値引き"]', '「値引きの前に、売場をどう変えるのかを聞かせてください」'),
  ('obs-saeki-kekka', 'buyer-saeki', 'mtg-saeki-1008', '試した結果の報告では、良くない数字も先に確かめようとしていた', '["結果","数字","試す"]', '「結果が悪くても、先に数字で教えてもらえると次が早いです」'),
  ('obs-saeki-tema', 'buyer-saeki', 'mtg-saeki-1008', '売場を動かす話では、店の手間がどれだけ増えるかを尋ねていた', '["店の手間","作業","全店"]', '「それ、店の手間はどれくらい増えますか」'),
  ('obs-saeki-draft', 'buyer-saeki', 'mtg-saeki-1027', '下書きの傾向：まだ人が確かめていない', '["売場"]', '「下書きの発言」'),
  ('obs-taka-arari', 'buyer-takatori', 'mtg-taka-0617', '企画の話では、粗利の裏付けがあるかを確かめていた', '["粗利","試算","チラシ"]', '「売れても粗利が残らないと、店長会を通りません」'),
  ('obs-taka-tameshi', 'buyer-takatori', 'mtg-taka-0826', '新しい売場の話には、少ない店舗で試す形で応じていた', '["試す","店舗"]', '「まず2店舗で見てみましょう」');

INSERT INTO season_events (id, name, month, day, deadline_month, deadline_day, store_action, proposal, own_result) VALUES
  ('ev-newyear', 'お正月', 1, 1, 10, 15, '年末からまとめ買いが動き、日用品の山積みが店頭に出る', '年末年始のまとめ買いに合わせて、ケース販売を提案する', '前の年末はゆず炭酸のケース販売で、12月の週販が前年比112%'),
  ('ev-setsubun', '節分', 2, 3, 11, 20, '1月末から食品の催事棚を小さく作る', '行事の食事に合わせる無糖の炭酸を、催事棚の端に少量置く', '前の年は3店舗で試し、催事棚の飲料の週販が前年比107%'),
  ('ev-school', '新入学・新生活', 3, 1, 12, 20, '3月の棚割り改定に合わせて定番を入れ替え、新生活の売場を作る', '一人暮らしを始める人に向けて、無糖の飲料を定番で提案する', '前の年の3月の改定で入れた1品は、4週間で棚に定着した'),
  ('ev-spring', '春の行楽', 4, 25, 2, 10, '連休の前に持ち歩きの飲料とお菓子を入口近くに寄せる', '持ち歩きやすい本数の組み合わせを提案する', '前の年は連休前の2週間で、自社の炭酸の週販が前年比109%'),
  ('ev-mother', '母の日', 5, 10, 3, 10, 'ギフトと健康食品を一緒に並べる', '健康を気づかう贈り物の横に置ける飲料を提案する', '実績は無い。前の年は提案していない'),
  ('ev-heat', '熱中症対策', 6, 15, 4, 10, '気温が上がる前に、飲料と塩分補給の品を前に出す', '暑さ対策の売場に、塩レモン炭酸のような塩分のある飲料を提案する', '前の年は6月の週販が前年比115%だったが、7月に伸びが止まった'),
  ('ev-gift', 'お中元', 7, 1, 4, 20, 'ギフトの予約が始まり、箱ものの見本を置く', '箱入りの飲料の詰め合わせを、予約の見本と一緒に提案する', '前の年は取り扱いが無かった'),
  ('ev-festival', '夏祭り', 8, 1, 5, 20, '地域の催しに合わせて、冷やす飲料の数を増やす', '催しの日に向けて、ケースの追加納品を提案する', '前の年は催しのある週の週販が前年比118%'),
  ('ev-obon', 'お盆の帰省', 8, 13, 6, 1, '帰省の手土産と大容量の品が動く', '地元の水を使った品を、手土産の棚に提案する', '前の年は2店舗で試し、手土産の棚の動きは前年並みだった'),
  ('ev-autumn', '秋の行楽・運動会', 10, 1, 7, 20, '9月の棚割り改定のあと、持ち歩きの飲料を増やす', '9月の改定に合わせて、持ち歩ける本数の組み合わせを提案する', '前の年は9月の改定で1品入れ替え、前年比104%'),
  ('ev-halloween', 'ハロウィン', 10, 31, 8, 20, 'お菓子の季節の棚を出し、飲料は脇に置く', '季節の棚に添える期間限定のラベルを提案する', '前の年はラベルの変更が間に合わなかった'),
  ('ev-xmas', 'クリスマス', 12, 24, 9, 30, 'パーティー向けの飲料とお菓子を組み合わせる', '集まりの食卓に置ける無糖の炭酸を提案する', '前の年は和食に合う切り口で話を聞いてもらえたが、採用は無かった');
