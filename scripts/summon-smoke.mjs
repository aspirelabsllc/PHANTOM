// Verify the plain-HTML starter layout: Vite mpa serves the three design dirs,
// three background commands run concurrently (the summon mechanism), and
// sync-assets.mjs reconciles public/assets/. Run: node scripts/summon-smoke.mjs
import { readFileSync } from "node:fs";
import { CodeSandbox } from "@codesandbox/sdk";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const page = (n) => `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>Apparition ${n}</title><link rel="stylesheet" href="./styles.css" /></head>
  <body class="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center">
    <h1 class="text-4xl font-light">Apparition ${n} — not yet condensed.</h1>
    <script src="./script.js"></script>
  </body>
</html>
`;

const files = {
  "package.json": JSON.stringify({
    name: "phantom-site", private: true, type: "module",
    scripts: { dev: "vite --host" },
    devDependencies: { "@tailwindcss/vite": "^4.0.0", tailwindcss: "^4.0.0", vite: "^6.0.7" },
  }, null, 2),
  "vite.config.js": `import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({ appType: 'mpa', plugins: [tailwindcss()], server: { host: true, port: 5173, strictPort: true, allowedHosts: true } });
`,
  "styles.css": `@import "tailwindcss";\n`,
  "index.html": `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Phantom Site</title><link rel="stylesheet" href="/styles.css"></head><body class="bg-neutral-950"><p>atrium</p></body></html>`,
  "public/assets/manifest.json": "[]\n",
  "designs/one/index.html": page("I"),
  "designs/one/styles.css": `@import "tailwindcss";\n`,
  "designs/one/script.js": "// noop\n",
  "designs/two/index.html": page("II"),
  "designs/two/styles.css": `@import "tailwindcss";\n`,
  "designs/two/script.js": "// noop\n",
  "designs/three/index.html": page("III"),
  "designs/three/styles.css": `@import "tailwindcss";\n`,
  "designs/three/script.js": "// noop\n",
  "sync-assets.mjs": [
    "import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';",
    "const spec = JSON.parse(readFileSync('assets.json', 'utf8'));",
    "mkdirSync('public/assets', { recursive: true });",
    "const keep = new Set(spec.files.map((f) => f.file));",
    "keep.add('manifest.json');",
    "for (const f of readdirSync('public/assets')) {",
    "  if (!keep.has(f)) rmSync('public/assets/' + f, { force: true, recursive: true });",
    "}",
    "for (const f of spec.files) {",
    "  const p = 'public/assets/' + f.file;",
    "  if (existsSync(p) || !f.url) continue;",
    "  try {",
    "    const r = await fetch(f.url);",
    "    if (!r.ok) { console.error('skip ' + f.file + ': HTTP ' + r.status); continue; }",
    "    writeFileSync(p, Buffer.from(await r.arrayBuffer()));",
    "  } catch (e) { console.error('skip ' + f.file + ': ' + e.message); }",
    "}",
    "writeFileSync('public/assets/manifest.json', JSON.stringify(spec.manifest, null, 2));",
    "console.log('assets in sync: ' + spec.files.length);",
  ].join("\n"),
};

const sdk = new CodeSandbox(process.env.CSB_API_KEY);
console.log("creating sandbox…");
const sb = await sdk.sandboxes.create();
console.log("id:", sb.id);
const client = await sb.connect();
for (const [p, c] of Object.entries(files)) await client.fs.writeTextFile(p, c);
console.log("npm install…");
await client.commands.run("npm install");
await client.commands.runBackground("npm run dev");

const token = await sdk.hosts.createToken(sb.id, { expiresAt: new Date(Date.now() + 3600_000) });
const base = sdk.hosts.getUrl({ sandboxId: sb.id, token: token.token }, 5173);
const u = new URL(base);

async function probe(path, marker) {
  const url = new URL(base);
  url.pathname = path;
  for (let i = 0; i < 12; i++) {
    try {
      const res = await fetch(url);
      const body = await res.text();
      if (res.status === 200 && body.includes(marker)) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 2500));
  }
  return false;
}

console.log("probing variant pages…");
console.log("  /designs/one/  :", await probe("/designs/one/", "Apparition I"));
console.log("  /designs/two/  :", await probe("/designs/two/", "Apparition II"));
console.log("  /designs/three/:", await probe("/designs/three/", "Apparition III"));
console.log("  atrium /       :", await probe("/", "atrium"));

// three concurrent background commands — the summon's execution mechanism
console.log("running 3 concurrent background commands…");
const outs = { one: "", two: "", three: "" };
await Promise.all(
  ["one", "two", "three"].map(async (v) => {
    const cmd = await client.commands.runBackground(
      `for i in 1 2 3; do echo '{"v":"${v}","i":'$i'}'; sleep 0.4; done`,
    );
    cmd.onOutput((chunk) => (outs[v] += chunk));
    await new Promise((resolve) => {
      cmd.onStatusChange((st) => {
        if (st === "FINISHED" || st === "ERROR" || st === "KILLED") resolve();
      });
    });
  }),
);
const concOk = ["one", "two", "three"].every((v) => (outs[v].match(/"i":3/) ? true : false));
console.log("  all three streamed + finished:", concOk);

// sync-assets: orphan pruned, data-URL file lands, manifest rewritten
await client.commands.run("touch public/assets/orphan.bin");
const spec = {
  files: [{ file: "hello.txt", url: "data:text/plain;base64,aGVsbG8gcGhhbnRvbQ==" }],
  manifest: [{ file: "hello.txt", type: "source", origin: "offered" }],
};
await client.fs.writeTextFile("assets.json", JSON.stringify(spec));
const syncOut = await client.commands.run("node sync-assets.mjs && ls public/assets && cat public/assets/hello.txt");
console.log("  sync output:", JSON.stringify(syncOut));
console.log(
  "  sync ok:",
  syncOut.includes("hello.txt") && syncOut.includes("hello phantom") && !syncOut.includes("orphan.bin"),
);

await sdk.sandboxes.shutdown(sb.id).catch(() => {});
console.log("done");
