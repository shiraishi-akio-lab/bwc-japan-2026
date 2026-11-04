-- 施策の結果。商談（meetings）に紐づけ、確定した商談の分だけを読む。入力画面は作らない
CREATE TABLE initiative_results (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings(id),
  initiative TEXT NOT NULL,      -- やった施策
  result TEXT NOT NULL,          -- 結果
  outcome TEXT NOT NULL CHECK (outcome IN ('good', 'bad')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 架空の見本データ（実在の企業・人物とは関係ありません）
-- 下書きの商談は、確定した記録だけを読むことを確かめるために残す
INSERT INTO meetings (id, account_id, buyer_id, held_on, kind, participants, summary, decisions_json, open_issues_json, status) VALUES
  ('mtg-saeki-1008', 'acc-harukaze', 'buyer-saeki', '2026-10-08', '定例商談', '佐伯（架空）／森川（架空）',
   '秋の売場の見直しの結果を確認した。4店舗で試した塩レモン炭酸の島陳列は、前年を下回った。',
   '["3月の棚割りの提案を次回の商談で持ってくる"]',
   '["塩レモン炭酸を棚に残すかは未定"]', 'confirmed'),
  ('mtg-saeki-1027', 'acc-harukaze', 'buyer-saeki', '2026-10-27', '電話メモ', '佐伯（架空）／森川（架空）',
   '電話で話した内容の下書き。まだ確定していない。',
   '[]', '[]', 'draft');

INSERT INTO initiative_results (id, meeting_id, initiative, result, outcome) VALUES
  ('res-saeki-island', 'mtg-saeki-1008', '塩レモン炭酸の島陳列（4店舗・4週間）', '週販は前年比88%。島に出しても売上は戻らなかった。', 'bad'),
  ('res-saeki-draft', 'mtg-saeki-1027', '下書きの施策（確定前）', '下書きの結果：まだ人が確かめていない。', 'good');
