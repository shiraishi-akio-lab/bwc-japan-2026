-- 行事の実績の言い方を直す：11月の商談から読むと「前の年の3月」がどの年か分からない
UPDATE season_events SET own_result = '直近の3月の改定で入れた1品は、4週間で棚に定着した' WHERE id = 'ev-school';
