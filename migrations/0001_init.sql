-- 練習（AI バイヤーとの5分ロールプレイ）
CREATE TABLE practice_sessions (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE practice_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES practice_sessions(id),
  role TEXT NOT NULL CHECK (role IN ('rep', 'buyer')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 商談後3分メモ（事実・解釈・次に確かめること）
CREATE TABLE memos (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES practice_sessions(id),
  facts TEXT NOT NULL,
  interpretation TEXT NOT NULL,
  next_check TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 確かめる係の「理解の地図」と、次を決める係の「次の一行動」
CREATE TABLE assessments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES practice_sessions(id),
  map_json TEXT NOT NULL,
  next_action_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 整理する係が作ったケースカードの候補（ベテランの承認待ち）
CREATE TABLE case_drafts (
  id TEXT PRIMARY KEY,
  source_text TEXT NOT NULL,
  card_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
