# CLAUDE.md — 隣席コーチ（仮）

Built with Claude: Japan 2026（2026-11-02〜11-08）の提出作品。このリポジトリは**公開される**前提で書く。

## 何を作るか
営業を採点する AI ではない。ベテランの商談の「なぜ」を残し、若手の理解に合わせて、次の一手を隣で練習させる AI。
舞台は架空の消費財メーカーの若手営業と、架空のドラッグストアのバイヤーの商談（`data/world.json`）。

## 構成
| 場所 | 中身 |
|---|---|
| `src/` | 画面（React + Vite + TypeScript） |
| `worker/` | API（Hono on Cloudflare Workers）。`/api/*` だけ Worker が受ける |
| `migrations/` | D1 のスキーマと架空の取引先データ（手元は `npm run db:migrate:local`） |
| `knowledge/` | **知識の正本**＝Obsidian の保管庫。物差し（`rubric/`・層1）、ケースカード（`cards/`・層2）、候補（`cards/_pending/`）、評価セット（`eval/`）を Markdown で書く。書き方は `knowledge/_はじめに.md` |
| `scripts/build-knowledge.mjs` | `knowledge/` → `data/*.json` の変換（`npm run knowledge`）。誤りがあれば何も書き出さずに止まる |
| `data/rubric.json`・`data/cases/`・`data/eval/` | **生成物。直接編集しない**。アプリはここを読む。指示文に物差しやカードを埋め込まない。根拠に使うのは `status: approved` のカードだけ |
| `data/world.json` | 舞台設定（架空の会社・人物）。これは手で編集する |

- 評価セットの `answer`（正解）は人（バイヤー側の経験者）が `knowledge/eval/` に書く。AI が書き換えない。

## 8つの係（Claude の役割）
1. 整理する係：ベテランの語り → ケースカードの候補（`pending`）。承認は人。
2. バイヤー役：若手との短い商談の練習。耳の痛いことも言う。担当バイヤーを選ぶと、その人の設定と記録を読んで演じる。
3. カードを選ぶ係：商談の流れと「効く条件」から、使うケースカードを3枚まで選ぶ。
4. 確かめる係：練習と3分メモから、5つの軸の「できていること／抜けていること」を出す。**根拠には rubric の軸とケースカードの id を必ず添える。根拠が無ければ「不明」**。
5. 次を決める係：次に鍛える一行動を**1つだけ**決める。総合点は出さない。カードの判断から始める。
6. 話し手を分ける係：録音の文字起こしを、営業とバイヤーの発言に分ける。
7. 議事録の係：文字起こしから、要約・決定事項・残った論点・次回の約束・「今大事にしていること」の候補を下書きする。候補の根拠はバイヤーの発言と一致するものだけ残す。
8. 引き継ぎの係：確定した記録から、後任に向けた引き継ぎ書を書く。これだけ Managed Agents で動かす（`worker/handoff.ts`）。Outcomes の別の採点係が基準を見て差し戻す。根拠のラベルが記録にあるかはコードでも確かめる。

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
```
