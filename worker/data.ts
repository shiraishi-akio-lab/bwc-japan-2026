import type { CaseCard } from "./types";

const modules = import.meta.glob<{ default: CaseCard }>("../data/cases/*.json", { eager: true });

export const cases: CaseCard[] = Object.values(modules).map((m) => m.default);

// 根拠に使ってよいのは承認済みのカードだけ
export const approvedCases: CaseCard[] = cases.filter((c) => c.status === "approved");
