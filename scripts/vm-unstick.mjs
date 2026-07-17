// Kill hung image-generation processes in a VM so a stalled subagent Bash
// returns and the build continues. Run: node scripts/vm-unstick.mjs <sandboxId>
import { readFileSync } from "node:fs";
import { CodeSandbox } from "@codesandbox/sdk";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const sdk = new CodeSandbox(process.env.CSB_API_KEY);
const sb = await sdk.sandboxes.resume(process.argv[2] || "vlqs6t");
const c = await sb.connect();
const run = (cmd) => c.commands.run(cmd).catch((e) => "ERR:" + e.message);
console.log("before:", (await run("pgrep -f 'gemini.sh|xai.sh|generativelanguage|api.x.ai' | tr '\\n' ' ' || echo none")).trim());
// kill the image-gen scripts + any curl they left hanging on the provider APIs
await run("pkill -9 -f 'gemini.sh' 2>/dev/null; pkill -9 -f 'xai.sh' 2>/dev/null; pkill -9 -f 'generativelanguage.googleapis' 2>/dev/null; pkill -9 -f 'api.x.ai' 2>/dev/null; true");
await new Promise((r) => setTimeout(r, 1500));
console.log("after:", (await run("pgrep -f 'gemini.sh|xai.sh|generativelanguage|api.x.ai' | tr '\\n' ' ' || echo none")).trim());
console.log("done");
process.exit(0);
