// Smoke-test the Claude Agent SDK runs headless with just ANTHROPIC_API_KEY.
// Run: node scripts/agent-smoke.mjs
import { readFileSync } from "node:fs";
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

let saved = null;
const server = createSdkMcpServer({
  name: "phantom",
  version: "1.0.0",
  tools: [
    tool(
      "save_brand",
      "Persist the extracted brand.",
      { name: z.string(), essence: z.string() },
      async (args) => {
        saved = args;
        return { content: [{ type: "text", text: "saved" }] };
      },
    ),
  ],
});

console.log("running query…");
const q = query({
  prompt:
    "The brand is called Aegis; its essence is 'quiet defense, nothing wasted'. Call save_brand with those, then reply DONE.",
  options: {
    model: "claude-opus-4-8",
    systemPrompt: "You extract brands. Use the save_brand tool.",
    mcpServers: { phantom: server },
    allowedTools: ["mcp__phantom__save_brand"],
    disallowedTools: ["Bash", "Read", "Write", "Edit", "WebSearch", "WebFetch"],
    maxTurns: 5,
  },
});

for await (const m of q) {
  if (m.type === "system") console.log("[system]", m.subtype, m.session_id ?? "");
  else if (m.type === "assistant") {
    for (const b of m.message.content) {
      if (b.type === "text") console.log("[assistant]", b.text.slice(0, 120));
      else if (b.type === "tool_use") console.log("[tool_use]", b.name, JSON.stringify(b.input));
    }
  } else if (m.type === "result") {
    console.log("[result]", m.subtype, "| result:", m.result?.slice(0, 80));
    console.log("[cost usd]", m.total_cost_usd);
  }
}
console.log("saved via tool:", saved);
