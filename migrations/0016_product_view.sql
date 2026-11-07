-- 新商品を本人の言葉で言う欄。相手の得を書く前に書く
ALTER TABLE preps ADD COLUMN product_view TEXT NOT NULL DEFAULT '';
