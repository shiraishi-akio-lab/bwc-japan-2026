# CLAUDE.md — 営業GYM

Built with Claude: Japan 2026（2026-11-02〜11-08）の提出作品。このリポジトリは**公開される**前提で書く。

## 何を作るか
営業を採点する AI ではない。ベテランの商談の「なぜ」を残し、若手の理解に合わせて、次の一手を隣で練習させる AI。
舞台は架空の消費財メーカーの若手営業が、架空のドラッグストアに3月の棚割りを提案する商談（`data/world.json`）。主役は商談前の準備室（`worker/prep.ts`・`src/Prep.tsx`）。

## 構成
| 場所 | 中身 |
|---|---|
| `src/` | 画面（React + Vite + TypeScript） |
| `public/sample-site/` | 架空の企業サイト（相手の棚のデモ用）。ページに `<meta name="sample-site">` を入れる |
| `worker/` | API（Hono on Cloudflare Workers）。`/api/*` だけ Worker が受ける |
| `migrations/` | D1 のスキーマと架空の取引先データ（手元は `npm run db:migrate:local`） |
| `knowledge/` | **知識の正本**＝Obsidian の保管庫。物差し（`rubric/`・層1）、ケースカード（`cards/`・層2）、候補（`cards/_pending/`）、評価セット（`eval/`）を Markdown で書く。書き方は `knowledge/_はじめに.md` |
| `scripts/build-knowledge.mjs` | `knowledge/` → `data/*.json` の変換（`npm run knowledge`）。誤りがあれば何も書き出さずに止まる |
| `data/rubric.json`・`data/cases/`・`data/eval/` | **生成物。直接編集しない**。アプリはここを読む。指示文に物差しやカードを埋め込まない。根拠に使うのは `status: approved` のカードだけ |
| `data/world.json` | 舞台設定（架空の会社・人物）。これは手で編集する |

- 評価セットの `answer`（正解）は人（バイヤー側の経験者）が `knowledge/eval/` に書く。AI が書き換えない。

## 10の係（Claude の役割）
1. 整理する係：ベテランの語り・過去の商談・資料の文字 → ケースカードの候補（`pending`）。貼られた文字は資料として読む。承認は人。
2. バイヤー役：若手との短い商談の練習。耳の痛いことも言う。担当バイヤーを選ぶと、その人の設定と記録を読んで演じる。準備室では段階をコードが持つ（下の「準備室」）。
3. カードを選ぶ係：商談の流れと「効く条件」から、使うケースカードを3枚まで選ぶ。
4. 確かめる係：練習と3分メモから、5つの軸の「できていること／抜けていること」を出す。**根拠には rubric の軸とケースカードの id を必ず添える。根拠が無ければ「不明」**。
5. 次を決める係：次に鍛える一行動を**1つだけ**決める。総合点は出さない。カードの判断から始める。
6. 話し手を分ける係：録音の文字起こしを、営業とバイヤーの発言に分ける。
7. 議事録の係：文字起こしから、要約・決定事項・残った論点・次回の約束・「今大事にしていること」の候補を下書きする。候補の根拠はバイヤーの発言と一致するものだけ残す。
8. 引き継ぎの係：確定した記録から、後任に向けた引き継ぎ書を書く。これだけ Managed Agents で動かす（`worker/handoff.ts`）。Outcomes の別の採点係が基準を見て差し戻す。根拠のラベルが記録にあるかはコードでも確かめる。
9. 相談文を書く係：返し・落としどころ・得の答え・棚の候補だけを読み、上司に確かめる1枚を下書きする。練習の発言・5軸・次の一行動は渡さない。返しと落としどころは Claude を通さずそのまま写す（`writeConsult`）。
10. 関心を読む係：公開ページの本文から、会社の関心の候補を出す（`readInterests`）。出どころの URL・題・日付はコードが付ける。ページに無い引用と数字はコードが落とす（`groundInterests`）。読める先は取引先に登録されたサイトだけ（`isRegisteredSite`）。

## 準備室
入口 → 前回の続き → 得意先の得 → 止まる練習 → ベテランの判断 → 返しを用意して答え直す → 上司への相談文。3分メモ・5軸・次の一行動は、準備室の練習からも開ける。
- 段階（`preps.stage`）は opening → asked → retry → refused → agreed／ended。立場はコードが決め、Claude は文面だけを書く。「どれを外すの？」は固定文。1本目は必ず断り、2本目は `agreementCondition` を満たせば合意する。1回に5発言で固定文で閉じ、答え直せば続く。
- 得の問いは固定の入力欄で Claude を使わない。候補は `shelfCandidates` がコードで並べる。得の答えが空なら API が候補とカードを返さない。
- 答え直しは同じセッションの続き（`/preps/:id/retry`）。「もう一度練習する」だけが新しいセッションを作る。
- デモのカードは `worker/card.ts` で固定する。承認済みでなければ返さない（画面は「カード準備中」）。
- 棚は `shelf_items`（若手に見える）と `shelf_buyer_notes`（バイヤー役だけ）に分ける。後者は API に返さない。
- 施策の結果は `initiative_results`。確定した商談の分だけを `confirmedResults` で読む。入力画面は無い。

## 相手の棚
準備室の「相手と時期の下調べ」1枚（`worker/counterpart.ts`・`src/Counterpart.tsx`）。全部は渡さず、`prepBrief` が当てはまるものを絞る。
- 企業の関心：`worker/site.ts` がトップからニュース・決算・取り組みをたどる。見本は `env.ASSETS`、実在の URL は検査つきの fetch で、後の経路は同じ。接続先の検査（`assertPublicUrl`・解決先のアドレス・転送の1段ごと）、ページ数・大きさ・時間の上限、robots.txt を守る。読んだ本文はデータとして渡す。`company_interests` は承認済みだけを読む。
- 担当者の傾向：`buyer_observations`。確定した商談の分だけを読む。観察された場面を書き、人を評価しない。`buyers.persona`・`shelf_buyer_notes` は混ぜない。
- ことカレンダー：`season_events`。提案の締切が商談日より先の行事を、コードが近い順に2件選ぶ（`selectEvents`）。
- POS：`pos_weekly`・`pos_sources`（`worker/pos.ts`）。読むのは売場全体と自社品だけで、他社品は行があっても読まない（他社品を含む棚の表はベテランの判断だけ）。平均と前年比はコードで計算し、見本は棚の表と一致させる。画面にだけ返し、Claude には渡さない。
- 相手の情報：`/preps/:id/partner`（`prepPartner`）。関心・傾向・POS・行事・前回の約束・確定した商談を1枚に。帯のボタンから重ねて開き、段階の画面は残す（書きかけが消えない）。残った論点は読まない（外す品の答えが問いより先に見えるため）。
- 渡す先：バイヤー役には関心と行事だけ（`buyerBriefText`）。確かめる係・次を決める係には全部（`coachBriefText`）。相談文を書く係には渡さない。

## ログインと権限
全 `/api` は既定で要ログイン。例外と役割は `worker/access.ts` の表だけで決める（表に無いルートは動かない。`demo:check` が定義と突き合わせる）。入口の判定は `worker/auth.ts` の `guard`。
- 役割は本人（rep）と上司（manager）。記録の担当は上司が兼ねる。判定はサーバーで行い、画面の出し分けは見た目だけ。
- 準備・練習・メモ・5軸・次の一行動は作成者本人だけが読む（`preps.user_id`・`practice_sessions.user_id`）。他人の id は 404。上司はこれらの API に入れない（403）。**上司の画面を監視の道具にしない**。
- 上司に届くのは、若手が「上司に出す」を押した相談文だけ（`preps.submitted_at`・`worker/manager.ts`）。相談文が変わると取り下げる。返事の画面は作らない。
- 会社の範囲は `accounts.company_id` からたどる（buyers・meetings・priorities・promises・棚・関心・引き継ぎ）。`case_drafts` と `users` は自分で `company_id` を持つ。`season_events` とカードの Markdown は全社共通。
- カードの候補は上司が画面で承認すると DB の状態が変わり、準備室のほかのカードと確かめる係の根拠になる（`companyCards`）。`knowledge/` の正本には戻らない。
- 架空ユーザーの初期パスワードはリポジトリに書かない。`npm run demo:users` が作って `.demo-users.local`（git 対象外）に置く。

## 取引先の記録
取引先 → 担当バイヤー → 議事録の順につなぐ（`migrations/0002_accounts.sql`・`worker/accounts.ts`・`src/Accounts.tsx`）。
- AI が読むのは**人が確かめた記録だけ**＝議事録は `confirmed`、「今大事にしていること」は `approved`。下書きと候補は読まない。
- バイヤーの設定（`persona`）はバイヤー役だけが読む。画面や API の応答に返さない。

計算・照合（一致率など）はコードで行い、Claude には数字を作らせない。

## 守ること
- データはすべて架空。実在の企業・店舗・人物・地域を思わせる名前や数字を入れない。
- 出力を人事評価・処遇に使う機能を作らない。練習と振り返りは初期設定で本人だけが見る。
- チャットボットにしない。会話は練習の部品で、主役は「整理する・確かめる・次を決める」。
- API キーは `.dev.vars`（手元）と Cloudflare の secret だけに置く。コード・設定・ログに書かない。
- 小さくコミットする（ハッカソン期間中に作ったことが履歴で分かるように）。
- 作業ディレクトリを移動しない。パスは絶対パスか、リポジトリのルートからの相対で扱う。

## コマンド
```bash
npm run knowledge         # knowledge/ の Markdown を data/ の JSON に変換
npm run dev               # 変換してから、画面と API を手元で起動（Vite + Cloudflare プラグイン）
npm run build             # 型チェックとビルド
npm run db:migrate:local  # 手元の D1 にスキーマを当てる
npm run eval              # 評価セットで一致率を測る（カードなし／ありの比較・明細は eval-results/）
npm run drafts:pull       # 整理する係の候補（手元の D1）を knowledge/cards/_pending/ に書き出す
npm run handoff:setup     # 引き継ぎの係の環境とエージェントを1回だけ作り、id を .dev.vars に足す
npm run demo:users        # 架空ユーザーを手元の D1 に入れる（パスワードは .demo-users.local。--rotate で作り直す）
npm run demo:reset        # デモの初期状態に戻す（手元の D1。npm run dev を動かしたままでよい）
npm run demo:check        # 台本確認（npm run dev を動かしたまま・Claude API を使う）。--runs=3 で周回数を指定
```
