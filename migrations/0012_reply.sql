-- 相談文への上司の返事：提案への判断と一言。AI は書かない。人の評価は入れない
ALTER TABLE preps ADD COLUMN reply_json TEXT NOT NULL DEFAULT '';
