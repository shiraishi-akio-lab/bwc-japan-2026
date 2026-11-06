import type { CaseCard } from "./types";

// デモで見せるカードはコードで固定する
export const DEMO_CARD_ID = "case-10";

// 根拠に使うのは承認済みだけ。未承認や不在は null（画面は「カード準備中」と出す）
export const approvedCard = (cards: CaseCard[], id: string): CaseCard | null =>
  cards.find((c) => c.id === id && c.status === "approved") ?? null;

export const cardBody = (c: CaseCard) => ({
  id: c.id, title: c.title, scene: c.scene, situation: c.situation, hypothesis: c.hypothesis, evidence: c.evidence,
  proposal: c.proposal, constraints: c.constraints, result: c.result, nextJudgment: c.nextJudgment,
  rejectedOptions: c.rejectedOptions,
});
