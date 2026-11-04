// 引き継ぎ書を作る Managed Agents の環境とエージェントを1回だけ作り、id を .dev.vars に足す
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const FILE = ".dev.vars";
const vars = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
const read = (name) => vars.split("\n").find((l) => l.startsWith(`${name}=`))?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");

if (read("HANDOFF_AGENT_ID")) {
  console.log("準備済みです（.dev.vars に HANDOFF_AGENT_ID があります）");
  process.exit(0);
}
const apiKey = read("ANTHROPIC_API_KEY");
if (!apiKey) throw new Error(".dev.vars に ANTHROPIC_API_KEY がありません");

const client = new Anthropic({ apiKey });
const environment = await client.beta.environments.create({
  name: "bwc-handoff",
  config: { type: "cloud", networking: { type: "limited", allow_package_managers: false, allow_mcp_servers: false } },
});
const agent = await client.beta.agents.create({
  name: "bwc-handoff",
  model: "claude-opus-5-5",
  system: "あなたは営業の引き継ぎ書を作る係です。渡された記録にあることだけを、後任の若手が読める言葉で書きます。",
  tools: [{
    type: "agent_toolset_20260401",
    default_config: { enabled: true, permission_policy: { type: "auto" } },
    configs: [{ name: "web_fetch", enabled: false }, { name: "web_search", enabled: false }],
  }],
});
appendFileSync(FILE, `${vars.endsWith("\n") || !vars ? "" : "\n"}HANDOFF_ENV_ID=${environment.id}\nHANDOFF_AGENT_ID=${agent.id}\n`);
console.log("準備しました。開発サーバーを起動し直してください");
