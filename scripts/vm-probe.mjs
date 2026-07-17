import { readFileSync } from "node:fs";
import { CodeSandbox } from "@codesandbox/sdk";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const sdk = new CodeSandbox(process.env.CSB_API_KEY);
const sb = await sdk.sandboxes.resume(process.argv[2] || "vlqs6t");
const c = await sb.connect();
const code = await c.commands
  .run("curl -s -m 4 -o /dev/null -w '%{http_code}' http://localhost:5173/designs/one/")
  .catch((e) => "ERR:" + e.message);
console.log("5173 /designs/one/:", JSON.stringify(code));
console.log("vite pids:", JSON.stringify(await c.commands.run("pgrep -f vite | tr '\\n' ' ' || echo none").catch((e) => e.message)));
process.exit(0);
