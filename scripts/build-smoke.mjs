// M3 core: boot a VM, run the agent INSIDE it (reaching Anthropic only via the
// deployed gateway with a session token), and confirm it edits the Vite app.
// Run: node scripts/build-smoke.mjs
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { CodeSandbox } from "@codesandbox/sdk";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const mintToken = (pid) => {
  const p = `${pid}.${Date.now() + 3600_000}`;
  return `pht_${p}.${createHmac("sha256", process.env.GATEWAY_SECRET).update(p).digest("base64url")}`;
};

const starter = {
  "package.json": JSON.stringify({
    name: "phantom-site", private: true, type: "module", scripts: { dev: "vite --host" },
    dependencies: { react: "^18.3.1", "react-dom": "^18.3.1" },
    devDependencies: { "@anthropic-ai/claude-agent-sdk": "^0.3.207", "@vitejs/plugin-react": "^4.3.4", "@tailwindcss/vite": "^4.0.0", tailwindcss: "^4.0.0", vite: "^6.0.7" },
  }, null, 2),
  "vite.config.js": `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nimport tailwindcss from '@tailwindcss/vite';\nexport default defineConfig({ plugins: [react(), tailwindcss()], server: { host: true, port: 5173, strictPort: true, allowedHosts: true } });\n`,
  "index.html": `<!doctype html><html><head><meta charset="UTF-8"><title>Site</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>`,
  "src/main.jsx": `import { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\nimport './index.css';\ncreateRoot(document.getElementById('root')).render(<App />);\n`,
  "src/index.css": `@import "tailwindcss";\n`,
  "src/App.jsx": `export default function App(){return <main className="min-h-screen flex items-center justify-center"><h1>starting point</h1></main>;}\n`,
};

const runner = [
  "import { query } from '@anthropic-ai/claude-agent-sdk';",
  "const prompt = process.env.PHANTOM_PROMPT || '';",
  "const emit = (o) => console.log(JSON.stringify(o));",
  "try {",
  "  for await (const m of query({ prompt, options: { model: 'claude-opus-4-8', systemPrompt: 'You edit files in this Vite+React project. Style with Tailwind. Keep valid JSX.', cwd: process.cwd(), allowedTools: ['Read','Write','Edit','Bash','Glob','Grep'], permissionMode: 'bypassPermissions', maxTurns: 30 } })) {",
  "    if (m.type === 'assistant' && m.message) { for (const b of m.message.content) { if (b.type === 'text' && b.text) emit({ t:'text', text:b.text.slice(0,80) }); else if (b.type === 'tool_use') emit({ t:'tool', verb:b.name, target:(b.input||{}).file_path||'' }); } }",
  "    else if (m.type === 'result') emit({ t:'result', subtype:m.subtype });",
  "  }",
  "} catch (e) { emit({ t:'error', message:String((e&&e.message)||e) }); }",
  "emit({ t:'end' });",
].join("\n");

const sdk = new CodeSandbox(process.env.CSB_API_KEY);
console.log("creating sandbox…");
const sb = await sdk.sandboxes.create();
console.log("id:", sb.id);
const client = await sb.connect();
for (const [p, c] of Object.entries(starter)) await client.fs.writeTextFile(p, c);
await client.fs.writeTextFile("agent-runner.mjs", runner);
console.log("npm install (vite + agent-sdk)…");
await client.commands.run("npm install");
await client.commands.runBackground("npm run dev");

const token = mintToken("smoke1234");
const gateway = `${process.env.APP_URL}/api/gw`;
console.log("running agent in VM → gateway:", gateway);
const cmd = await client.commands.runBackground("node agent-runner.mjs", {
  env: {
    ANTHROPIC_BASE_URL: gateway,
    ANTHROPIC_API_KEY: token,
    IS_SANDBOX: "1",
    PHANTOM_PROMPT: "Rewrite src/App.jsx so the page centers a big headline reading exactly: THE VEIL PARTS — on a black background, cyan text. Keep it a valid default-export React component.",
  },
});
cmd.onOutput((chunk) => process.stdout.write(chunk));
await new Promise((resolve) => cmd.onStatusChange((s) => { if (s === "FINISHED" || s === "ERROR" || s === "KILLED") resolve(); }));

const app = await client.fs.readTextFile("src/App.jsx");
console.log("\n=== App.jsx now contains 'THE VEIL PARTS':", app.includes("THE VEIL PARTS"), "===");
console.log(app.slice(0, 400));
await sdk.sandboxes.shutdown(sb.id).catch(() => {});
console.log("done");
