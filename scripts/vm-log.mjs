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
console.log("=== /tmp/vite.log ===\n" + (await run("cat /tmp/vite.log 2>&1 | tail -40")));
console.log("=== git status ===\n" + (await run("git log --oneline -1 2>&1; git status --short 2>&1 | head")));
console.log("=== root files ===\n" + (await run("ls -1 2>&1 | head -40")));
console.log("=== package.json ===\n" + (await run("cat package.json 2>&1 | head -30")));
console.log("=== vite.config ===\n" + (await run("cat vite.config.js 2>&1")));
console.log("=== try vite foreground (5s) ===\n" + (await run("timeout 8 npm run dev 2>&1 | head -30 || true")));
process.exit(0);
