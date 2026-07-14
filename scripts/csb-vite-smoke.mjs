// Verify a Vite+React+Tailwind app boots in a sandbox and previews.
// Run: node scripts/csb-vite-smoke.mjs
import { readFileSync } from "node:fs";
import { CodeSandbox } from "@codesandbox/sdk";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const files = {
  "package.json": JSON.stringify({
    name: "phantom-site", private: true, type: "module",
    scripts: { dev: "vite --host" },
    dependencies: { react: "^18.3.1", "react-dom": "^18.3.1" },
    devDependencies: { "@vitejs/plugin-react": "^4.3.4", "@tailwindcss/vite": "^4.0.0", tailwindcss: "^4.0.0", vite: "^6.0.7" },
  }, null, 2),
  "vite.config.js": `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nimport tailwindcss from '@tailwindcss/vite';\nexport default defineConfig({ plugins: [react(), tailwindcss()], server: { host: true, port: 5173, strictPort: true, allowedHosts: true } });\n`,
  "index.html": `<!doctype html><html><head><meta charset="UTF-8"><title>Phantom Site</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>`,
  "src/main.jsx": `import { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\nimport './index.css';\ncreateRoot(document.getElementById('root')).render(<App />);\n`,
  "src/index.css": `@import "tailwindcss";\n`,
  "src/App.jsx": `export default function App(){return <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center"><h1 className="text-4xl">The form is taking shape.</h1></main>;}\n`,
};

const sdk = new CodeSandbox(process.env.CSB_API_KEY);
console.log("creating sandbox…");
const sb = await sdk.sandboxes.create();
console.log("id:", sb.id);
const client = await sb.connect();
for (const [p, c] of Object.entries(files)) await client.fs.writeTextFile(p, c);
console.log("npm install… (this takes a bit)");
const inst = await client.commands.run("npm install");
console.log("install done");
await client.commands.runBackground("npm run dev");
console.log("dev started; waiting for vite…");

const token = await sdk.hosts.createToken(sb.id, { expiresAt: new Date(Date.now() + 3600_000) });
const url = sdk.hosts.getUrl({ sandboxId: sb.id, token: token.token }, 5173);
console.log("preview:", url);

let ok = false;
for (let i = 0; i < 15; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  try {
    const res = await fetch(url);
    const body = await res.text();
    if (res.status === 200 && body.includes('id="root"')) { ok = true; console.log(`ready after ${(i + 1) * 3}s`); break; }
  } catch {}
}
console.log("vite preview served root:", ok);
await sdk.sandboxes.shutdown(sb.id).catch(() => {});
console.log("done");
