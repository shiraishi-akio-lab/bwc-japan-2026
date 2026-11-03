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
