-- 商談のゴール：何のために会うかを、準備の最初に本人が決める
ALTER TABLE preps ADD COLUMN goal TEXT NOT NULL DEFAULT '';        -- 今回は何のために会うか（本人の言葉）
ALTER TABLE preps ADD COLUMN occasion_id TEXT NOT NULL DEFAULT ''; -- 狙う機会（season_events の id）
