// Restore the dev-server config + restart vite in a project's VM.
// Run: node scripts/vm-fix.mjs <sandboxId>
import { readFileSync } from "node:fs";
import { CodeSandbox } from "@codesandbox/sdk";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const VITE_CONFIG = `import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  appType: 'mpa',
  plugins: [tailwindcss()],
  server: { host: true, port: 5173, strictPort: true, allowedHosts: true },
});
`;
const PKG = JSON.stringify(
  {
    name: "phantom-site",
    private: true,
    type: "module",
    scripts: { dev: "vite --host" },
    devDependencies: {
      "@anthropic-ai/claude-agent-sdk": "^0.3.207",
      "@tailwindcss/vite": "^4.0.0",
      tailwindcss: "^4.0.0",
      vite: "^6.0.7",
    },
  },
  null,
  2,
);

const id = process.argv[2] || "vlqs6t";
const sdk = new CodeSandbox(process.env.CSB_API_KEY);
const sb = await sdk.sandboxes.resume(id);
const c = await sb.connect();
const run = (cmd) => c.commands.run(cmd).catch((e) => "ERR:" + e.message);

await c.fs.writeTextFile("vite.config.js", VITE_CONFIG);
await c.fs.writeTextFile("package.json", PKG);
console.log("restored config");

// [v]ite bracket trick so pkill doesn't match its own command line — and the
// kill must be its own command: any plain "vite" substring in the same line
// (like node_modules/@tailwindcss/vite) makes pkill -f kill its own shell (137)
await run("pkill -9 -f '[v]ite' 2>/dev/null; true");
await run("sleep 2; test -d node_modules/@tailwindcss/vite || npm install; true");
await c.commands.runBackground("npm run dev");

let ok = "000";
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  ok = (await run("curl -s -m 4 -o /dev/null -w '%{http_code}' http://localhost:5173/designs/one/")).trim();
  if (ok === "200") break;
}
console.log("5173 /designs/one/:", ok);
if (ok !== "200") console.log("log:", await run("tail -25 /tmp/devserver.log /tmp/vite.log 2>&1; ss -tlnp 2>/dev/null | grep 5173 || echo 'nothing on 5173'"));
process.exit(0);
