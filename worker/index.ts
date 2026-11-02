import { Hono } from "hono";
import rubric from "../data/rubric.json";
import { cases } from "./data";

type Bindings = { DB: D1Database; ANTHROPIC_API_KEY?: string };

const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/health", (c) =>
  c.json({ ok: true, rubricAxes: rubric.axes.length, cases: cases.length }),
);

export default app;
