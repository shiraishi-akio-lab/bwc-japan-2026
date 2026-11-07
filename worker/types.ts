export type AxisId = "customer" | "evidence" | "hypothesis" | "feasibility" | "dialogue";

export type CaseCard = {
  id: string;
  title: string;
  status: "pending" | "approved";
  scene: string;
  axes: AxisId[];
  appliesWhen: string;
  situation: string;
  hypothesis: string;
  evidence: string;
  proposal: string;
  constraints: string;
  result: string;
  nextJudgment: string;
  rejectedOptions: { option: string; reason: string }[];
  author: string;
};

// 公開情報から読んだ関心の種類。棚の提案に結びつくものだけを準備室に出す
export const INTEREST_THEMES = ["売場・品ぞろえ", "健康", "来店・販促", "店舗の作業", "PB", "その他"] as const;
export type InterestTheme = (typeof INTEREST_THEMES)[number];

// ログイン中の人。役割の判定はサーバーだけが行う
export type SessionUser = {
  id: string; company_id: string; email: string; display_name: string; role: "rep" | "manager"; manager_id: string | null; company_name: string;
};

export type AppEnv = {
  Bindings: { DB: D1Database; ASSETS: Fetcher; ANTHROPIC_API_KEY?: string; DEMO_ENTRY?: string; HANDOFF_AGENT_ID?: string; HANDOFF_ENV_ID?: string };
  Variables: { user: SessionUser };
};
