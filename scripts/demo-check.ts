// 台本確認：同じ台本で準備室を最初から最後まで通し、段階と門をコードで確かめる。
// 使い方：npm run dev を動かしたまま  npm run demo:reset && npm run demo:check
//         npm run demo:check -- --runs=3   （既定は10周。最初の3周は相談文まで、1周目は3分メモと途中で閉じる場面も通す）
// 手元の D1 に準備が増える。終わったら npm run demo:reset で戻す。
import { getPlatformProxy } from "wrangler";
import { buildRecord, loadBuyer } from "../worker/accounts";
import { approvedCard } from "../worker/card";
import { KEY_QUESTION } from "../worker/claude";
import { agreementCondition, shelfCandidates, type ShelfItem } from "../worker/shelf";
import type { CaseCard } from "../worker/types";

const BASE = process.env.BASE_URL ?? "http://localhost:5179";
const RUNS = Number(process.argv.find((a) => a.startsWith("--runs="))?.split("=")[1] ?? 10);
const FULL_RUNS = 3;
const BUYER = "buyer-saeki";

// 棚の見本データの期待値は手で書く（関数の出力と比べるため、同じ関数を通さない）
const EXPECTED_IDS = ["shelf-shiolemon", "shelf-ginger", "shelf-mulemon", "shelf-yuzu", "shelf-cola-zero"];
const CARD_ID = "case-10";
const PRACTICE_MARK = "台本確認だけの言い回し";
const SHELF_NAMES = ["塩レモン", "ジンジャーエール", "無糖レモン", "ゆず炭酸", "コーラゼロ", "強炭酸", "無糖炭酸水"];

const SCRIPT = {
  gain: "棚全体の回転が上がり、健康の売場で来店が増えること",
  pitch: `${PRACTICE_MARK}で、3月の棚割りに和ハーブ炭酸を入れていただきたいです`,
  returns: ["弊社の塩レモン炭酸を外して、和ハーブ炭酸を入れる", "8店舗で3か月だけ試して、数字で判断してもらう"],
  landing: "今回の改定は見送り、次の改定に向けて確かめることを約束する",
  stuck: "えっと、今ある品はそのままで、入れていただけないかと",
  first: "弊社の塩レモン炭酸を外して、和ハーブ炭酸を入れてはいかがでしょうか",
  second: "では、8店舗で3か月だけ試して、数字を見て判断していただけませんか",
};

type Turn = { role: "rep" | "buyer"; content: string };
type Prep = {
  id: string; sessionId: string; meetingOn: string; gainAnswer: string; returns: string[]; landing: string; stage: string; turns: Turn[];
  consult: { returns: string[]; landing: string; summary: string; concessions: string[]; asks: string[] } | null;
};
type Recap = { promises: { text: string }[]; results: { initiative: string; result: string; outcome: string }[]; askCause: boolean };

let failed = 0;
const ok = (cond: boolean, label: string, detail = "") => {
  if (!cond) failed++;
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${detail ? `：${detail}` : ""}`);
};

async function call<T>(method: string, url: string, body?: unknown): Promise<{ status: number; body: T; raw: string }> {
  const r = await fetch(`${BASE}/api${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await r.text();
  return { status: r.status, body: JSON.parse(raw) as T, raw };
}

const proxy = await getPlatformProxy<{ DB: D1Database }>();
const db = proxy.env.DB;

// バイヤーだけの列が応答に混じらないかの物差し（値は D1 から読む）
const { results: notes } = await db.prepare("SELECT gross_margin_pct, note FROM shelf_buyer_notes").all<{ gross_margin_pct: number; note: string }>();
const persona = (await db.prepare("SELECT persona FROM buyers WHERE id = ?").bind(BUYER).first<{ persona: string }>())!.persona;
const SECRETS = ["gross_margin", "delist_plan", "persona", "第一候補", persona, ...notes.map((n) => n.note), ...notes.map((n) => `${n.gross_margin_pct}%`)];
const leaks = (raw: string) => SECRETS.filter((s) => raw.includes(s));
ok(leaks(`{"note":"${notes[0].note}"}`).length > 0, "漏れの物差しが、混じったものを実際に拾える");

// Claude を使わない部分
console.log("■ コードだけの確かめ");
const shelfRow = (id: string, weekly_units: number, is_pb = 0): ShelfItem => ({ id, name: id, short_name: id, maker: "", is_own: 0, is_pb, facings: 1, weekly_units, yoy_pct: 100 });
ok(shelfCandidates([shelfRow("b", 5), shelfRow("a", 9), shelfRow("pb", 1, 1)]).map((c) => c.id).join() === "b,a", "候補は週販の低い順で PB を除く");
const names = ["塩レモン炭酸"];
ok(agreementCondition("塩レモン炭酸を外します", names, [], ""), "品名を言えば合意の条件を満たす");
ok(agreementCondition("まず数店で試して判断を", names, [], ""), "試す線を言えば合意の条件を満たす");
ok(agreementCondition(SCRIPT.landing, names, [], SCRIPT.landing), "落としどころを言えば合意の条件を満たす");
ok(!agreementCondition("では値引きします", names, SCRIPT.returns, SCRIPT.landing), "値引きだけでは合意しない");
ok(!agreementCondition("えっと、その", names, SCRIPT.returns, SCRIPT.landing), "準備の無い一言では合意しない");
ok(!agreementCondition("塩レモン炭酸を値引きします", names, SCRIPT.returns, SCRIPT.landing), "品名を言っても値引きなら合意しない");
ok(!agreementCondition("期間限定で値引きします", names, SCRIPT.returns, SCRIPT.landing), "試す語があっても値引きなら合意しない");
ok(!agreementCondition("塩レモン炭酸は外しません", names, SCRIPT.returns, SCRIPT.landing), "外さないと言えば合意しない");
ok(!agreementCondition("試すつもりはありません", names, SCRIPT.returns, SCRIPT.landing), "試さないと言えば合意しない");
ok(!agreementCondition("無糖炭酸水を外してください", names, SCRIPT.returns, SCRIPT.landing), "PB を名指ししても合意しない");
ok(!agreementCondition(SCRIPT.first, names, SCRIPT.returns, SCRIPT.landing, [SCRIPT.first]), "断られた案の言い直しでは合意しない");
const card = (id: string, status: string) => ({ id, status }) as CaseCard;
ok(approvedCard([card(CARD_ID, "pending")], CARD_ID) === null, "未承認のカードは返さない（画面はカード準備中）");
ok(approvedCard([], CARD_ID) === null, "カードが無くても落ちない");
ok(approvedCard([card(CARD_ID, "approved")], CARD_ID)?.id === CARD_ID, "承認済みのカードは返す");

// 確定していない商談の結果は Claude に渡さない（渡す文そのものを見る）
const { results: draftResults } = await db.prepare(
  "SELECT r.result FROM initiative_results r JOIN meetings m ON m.id = r.meeting_id WHERE m.buyer_id = ? AND m.status = 'draft'",
).bind(BUYER).all<{ result: string }>();
ok(draftResults.length > 0, "下書きの商談に結果が入っている（陰性対照）", `${draftResults.length}件`);
const found = (await loadBuyer(db, BUYER))!;
const record = await buildRecord(db, found.buyer, found.account);
ok(draftResults.every((d) => !record.includes(d.result)), "下書きの結果が Claude への記録に出ない");
ok(record.includes("島陳列"), "確定した結果は Claude への記録に入る");

async function practiceRun(n: number): Promise<boolean> {
  const before = failed;
  console.log(`\n■ ${n}周目`);
  const { body: created } = await call<Prep>("POST", "/preps", { buyerId: BUYER, meetingOn: "2026-11-12" });
  const id = created.id;

  // 門：得の答えが空なら候補もカードも返さない。空白だけも同じ
  const gate1 = await call<Record<string, unknown>>("GET", `/preps/${id}/judgment`);
  ok(gate1.status === 409 && !("candidates" in gate1.body) && !("card" in gate1.body), "得の答えが空なら候補とカードを返さない", `HTTP ${gate1.status}`);
  await call("PATCH", `/preps/${id}`, { gainAnswer: "   " });
  const gate2 = await call<Record<string, unknown>>("GET", `/preps/${id}/judgment`);
  ok(gate2.status === 409 && !("candidates" in gate2.body), "空白だけの答えでも返さない", `HTTP ${gate2.status}`);
  ok((await call("POST", `/preps/${id}/turn`, { text: "話します" })).status === 409, "得の答えの前には話せない");

  // 再読み込み：別のリクエストで同じ内容が返る
  await call("PATCH", `/preps/${id}`, { gainAnswer: SCRIPT.gain });
  const { body: reread } = await call<Prep>("GET", `/preps/${id}`);
  await call("PATCH", `/preps/${id}`, { returns: [SCRIPT.returns[0]], landing: "" });
  const partial = (await call<Prep>("GET", `/preps/${id}`)).body;
  ok(reread.gainAnswer === SCRIPT.gain && reread.meetingOn === "2026-11-12" && partial.returns.join() === SCRIPT.returns[0] && partial.stage === "opening", "読み直しても準備の内容が残る（書きかけの返しと段階も）");
  ok((await call("GET", `/preps/${id}/judgment`)).status === 409, "問いを受ける前は候補を返さない");

  // 固定の問い
  const asked = await call<{ move: string; prep: Prep }>("POST", `/preps/${id}/turn`, { text: SCRIPT.pitch });
  const q = asked.body.prep.turns.at(-1)?.content;
  ok(q === KEY_QUESTION && asked.body.move === "question", "「どれを外すの？」が出る", q);

  if (n <= FULL_RUNS) {
    // 問いのあとに答えようとしても、バイヤーは答えを教えない
    const pushed = await call<{ move: string; prep: Prep }>("POST", `/preps/${id}/turn`, { text: SCRIPT.stuck });
    const line = pushed.body.prep.turns.at(-1)?.content ?? "";
    ok(pushed.body.move === "push" && pushed.body.prep.stage === "asked", "止まった答えには詰めるだけで受けない", line);
    ok(!SHELF_NAMES.some((s) => line.includes(s)), "詰める文に棚の品名が出ない");
    ok(leaks(pushed.raw).length === 0, "詰める文にバイヤーだけの列が無い", leaks(pushed.raw).join("／"));
  }

  // 候補とカード
  const j = await call<{ candidates: { id: string }[]; card: { id: string; proposal: string } | null }>("GET", `/preps/${id}/judgment`);
  ok(j.body.candidates.map((c) => c.id).join() === EXPECTED_IDS.join(), "候補がコードの並び順と一致する");
  ok(j.body.card?.id === CARD_ID && (j.body.card?.proposal ?? "").length > 0, "指定のカード本文が出る", j.body.card?.id ?? "準備中");
  ok(leaks(j.raw).length === 0, "候補の応答にバイヤーだけの列が無い", leaks(j.raw).join("／"));

  // 返しを用意せずに答え直せない
  ok((await call("POST", `/preps/${id}/retry`)).status === 400, "返しが無ければ答え直せない");
  await call("PATCH", `/preps/${id}`, { returns: SCRIPT.returns, landing: SCRIPT.landing });
  const countBefore = (await call<Prep>("GET", `/preps/${id}`)).body.turns.length;
  const retried = await call<Prep>("POST", `/preps/${id}/retry`);
  ok(retried.body.sessionId === created.sessionId && retried.body.turns.length === countBefore + 1, "答え直しは同じ商談の続き", `発言 ${countBefore}→${retried.body.turns.length}`);

  const first = await call<{ move: string; prep: Prep }>("POST", `/preps/${id}/turn`, { text: SCRIPT.first });
  ok(first.body.move === "refuse" && first.body.prep.stage === "refused", "1本目は断る", first.body.prep.turns.at(-1)?.content);
  ok(leaks(first.raw).length === 0, "バイヤーの断りに非公開の文がそのまま出ない", leaks(first.raw).join("／"));

  if (n === 1) {
    // 上限：合意の条件を満たさないまま話し続けても詰まらず、答え直せば続く
    let last = first;
    for (let i = 0; i < 5 && last.body.prep.stage === "refused"; i++) {
      last = await call("POST", `/preps/${id}/turn`, { text: "えっと、その、よろしくお願いします" });
      ok(leaks(last.raw).length === 0, "聞き返す文にバイヤーだけの列が無い", leaks(last.raw).join("／"));
    }
    ok(last.body.prep.stage === "ended" && last.body.move === "closed", "上限の前に固定文で閉じる", last.body.prep.turns.at(-1)?.content);
    ok((await call<Prep>("POST", `/preps/${id}/retry`)).status === 200, "閉じたあとも答え直せる");
    const again = await call<{ move: string }>("POST", `/preps/${id}/turn`, { text: SCRIPT.first });
    ok(again.body.move === "refuse", "答え直すと1本目からになる");
  }

  const second = await call<{ move: string; prep: Prep }>("POST", `/preps/${id}/turn`, { text: SCRIPT.second });
  ok(second.body.move === "agree" && second.body.prep.stage === "agreed", "2本目で合意する", second.body.prep.turns.at(-1)?.content);
  ok(leaks(second.raw).length === 0, "合意の文にバイヤーだけの列が無い", leaks(second.raw).join("／"));

  if (n <= FULL_RUNS) {
    // 前回の続き
    const recap = await call<Recap>("GET", `/preps/${id}/recap`);
    ok(recap.body.results.some((r) => r.outcome === "bad") && recap.body.askCause, "悪い結果が出て、原因の仮説を問う");
    ok(draftResults.every((d) => !recap.raw.includes(d.result)) && !recap.raw.includes("下書き"), "下書きの結果が画面の応答に出ない");
    ok(recap.body.promises.length > 0, "前回の約束が出る", recap.body.promises[0]?.text);

    let next = "";
    if (n === 1) {
      // 3分メモ・5軸・次の一行動は今のまま動く。その出力は相談文に入らない
      const checked = await call<{ axes: unknown[]; next: { action: string; tryLine: string } }>("POST", `/practice/${created.sessionId}/check`, {
        facts: "塩レモン炭酸は根拠が足りないと言われた", interpretation: "試す線なら話が進む", nextCheck: "試す店舗",
      });
      ok(checked.status === 200 && checked.body.axes.length === 5 && !!checked.body.next.action, "3分メモから5軸と次の一行動が出る", checked.body.next?.action);
      next = checked.body.next?.action ?? "";
    }

    // 相談文
    const consulted = await call<Prep>("POST", `/preps/${id}/consult`);
    const c = consulted.body.consult;
    const axes = (await call<{ name: string }[]>("GET", "/rubric")).body.map((a) => a.name);
    const sheet = JSON.stringify(c);
    ok(consulted.status === 200 && (c?.returns.length ?? 0) >= 2 && c?.landing === SCRIPT.landing, "相談文に返し2本以上と落としどころがある", c?.summary);
    ok(!sheet.includes(PRACTICE_MARK) && !sheet.includes(SCRIPT.first) && !sheet.includes(SCRIPT.second), "相談文に練習の発言が入らない");
    ok(axes.every((a) => !sheet.includes(a)), "相談文に5軸が入らない");
    ok(!next || !sheet.includes(next), "相談文に次の一行動が入らない");
    ok(leaks(sheet).length === 0, "相談文にバイヤーだけの列が無い", leaks(sheet).join("／"));
    await call("PATCH", `/preps/${id}`, { landing: SCRIPT.landing });
    ok(!!(await call<Prep>("GET", `/preps/${id}`)).body.consult, "返しを変えなければ相談文は残る");
    await call("PATCH", `/preps/${id}`, { landing: `${SCRIPT.landing}。` });
    ok((await call<Prep>("GET", `/preps/${id}`)).body.consult === null, "返しを変えたら古い相談文は消える");
    console.log(`    確かめたいこと：${c?.asks.join(" ／ ")}`);
  }
  return failed === before;
}

// 準備の無い相談文は Claude を呼ばずに止まる
const { body: empty } = await call<Prep>("POST", "/preps", { buyerId: BUYER, meetingOn: "2026-11-12" });
ok((await call("POST", `/preps/${empty.id}/consult`)).status === 400, "返しが無ければ相談文を作らない");

// 問いのあとで止まり続けても詰まらない
console.log("\n■ 問いのあとに話し続ける");
const { body: stuck } = await call<Prep>("POST", "/preps", { buyerId: BUYER, meetingOn: "2026-11-12" });
await call("PATCH", `/preps/${stuck.id}`, { gainAnswer: SCRIPT.gain, returns: SCRIPT.returns, landing: SCRIPT.landing });
let lastStuck = await call<{ move: string; prep: Prep }>("POST", `/preps/${stuck.id}/turn`, { text: SCRIPT.pitch });
for (let i = 0; i < 5 && lastStuck.body.prep.stage === "asked"; i++) {
  lastStuck = await call("POST", `/preps/${stuck.id}/turn`, { text: SCRIPT.stuck });
}
ok(lastStuck.body.prep.stage === "ended" && lastStuck.body.move === "closed", "問いの段階でも上限の前に固定文で閉じる", lastStuck.body.prep.turns.at(-1)?.content);
ok((await call("GET", `/preps/${stuck.id}/judgment`)).status === 200, "閉じたあともベテランの判断は開ける");
ok((await call("POST", `/preps/${stuck.id}/retry`)).status === 200, "閉じたあとも答え直せる");

const passed: boolean[] = [];
for (let n = 1; n <= RUNS; n++) passed.push(await practiceRun(n));

// 応答全体：persona と非公開の列が、ほかの API からも出ない
console.log("\n■ ほかの API");
for (const url of ["/buyers", "/accounts", "/accounts/acc-harukaze", `/buyers/${BUYER}`, "/preps/buyers", "/preps", `/preps/${empty.id}`]) {
  const r = await call("GET", url);
  ok(leaks(r.raw).length === 0, `${url} にバイヤーだけの列が無い`, leaks(r.raw).join("／"));
}

await proxy.dispose();
console.log(`\n周回：${passed.filter(Boolean).length}/${RUNS} 通過／✗ ${failed} 件`);
process.exit(failed === 0 ? 0 : 1);
