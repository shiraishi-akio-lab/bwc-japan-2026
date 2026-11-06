-- ログインと権限。会社 → ユーザー → ログインのセッションの順につなぐ。
-- ユーザーの行はここに書かない（初期パスワードをリポジトリに残さない）。npm run demo:users が手元の D1 にだけ入れる
CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO companies (id, name) VALUES ('co-mizunagi', 'ミズナギ飲料（架空）');

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('rep', 'manager')),
  manager_id TEXT REFERENCES users(id), -- 相談文の届く先
  password_hash TEXT NOT NULL,          -- pbkdf2$反復回数$塩$ハッシュ
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- practice_sessions（練習）とは別物。トークンそのものは保存しない
CREATE TABLE login_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,          -- UNIX 秒
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX login_sessions_user ON login_sessions(user_id);

-- 回数の上限（ログインの失敗・公開情報の読み取りなど）。メールと接続元はハッシュにして鍵にする
CREATE TABLE throttles (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_end INTEGER NOT NULL           -- UNIX 秒。ここまでは数え続け、上限を超えていれば断る
);

-- 会社の範囲：accounts が会社を持ち、buyers・meetings・棚・関心・引き継ぎは取引先からたどる
ALTER TABLE accounts ADD COLUMN company_id TEXT NOT NULL DEFAULT 'co-mizunagi';
ALTER TABLE case_drafts ADD COLUMN company_id TEXT NOT NULL DEFAULT 'co-mizunagi';
ALTER TABLE case_drafts ADD COLUMN user_id TEXT REFERENCES users(id);

-- 所有者：準備・練習（と、そこにぶら下がるメモ・評価）は作った本人だけが読む
ALTER TABLE practice_sessions ADD COLUMN user_id TEXT REFERENCES users(id);
ALTER TABLE preps ADD COLUMN user_id TEXT REFERENCES users(id);
ALTER TABLE preps ADD COLUMN submitted_at TEXT NOT NULL DEFAULT ''; -- 若手が「上司に出す」を押した時刻。相談文が変わると空に戻す
