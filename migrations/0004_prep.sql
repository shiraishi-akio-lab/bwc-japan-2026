-- 商談前の準備室。1件の準備に練習のセッションを1つ持たせ、答え直しも同じセッションの続きにする
CREATE TABLE preps (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES practice_sessions(id),
  buyer_id TEXT NOT NULL REFERENCES buyers(id),
  meeting_on TEXT NOT NULL,                  -- 次の商談日
  gain_answer TEXT NOT NULL DEFAULT '',      -- 相手の得は何か（若手が自分の言葉で書く）
  cause_hypothesis TEXT NOT NULL DEFAULT '', -- 前回の結果が悪かったときの、原因の仮説
  returns_json TEXT NOT NULL DEFAULT '[]',   -- 用意した返し（2〜3本）
  landing TEXT NOT NULL DEFAULT '',          -- 落としどころ
  stage TEXT NOT NULL DEFAULT 'opening'
    CHECK (stage IN ('opening', 'asked', 'retry', 'refused', 'agreed', 'ended')),
  round_turns INTEGER NOT NULL DEFAULT 0,    -- 今の回で若手が話した回数（答え直すと0に戻る）
  consult_json TEXT NOT NULL DEFAULT '',     -- 上司への相談文
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
