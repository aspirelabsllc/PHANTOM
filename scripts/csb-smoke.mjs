// Smoke-test the CodeSandbox runtime: boot a sandbox, write a file, serve it,
// mint a preview URL, and fetch it back. Run: node scripts/csb-smoke.mjs
import { readFileSync } from "node:fs";
import { CodeSandbox } from "@codesandbox/sdk";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const sdk = new CodeSandbox(process.env.CSB_API_KEY);

console.log("creating sandbox…");
const sandbox = await sdk.sandboxes.create();
console.log("sandbox id:", sandbox.id);

const client = await sandbox.connect();
console.log("connected. writing files…");

await client.fs.writeTextFile(
  "index.html",
  "<!doctype html><meta charset=utf8><title>phantom</title><h1>PHANTOM sandbox is live</h1>",
);
await client.fs.writeTextFile(
  "server.mjs",
  `import http from 'node:http';
import { readFileSync } from 'node:fs';
const port = process.env.PORT || 3000;
http.createServer((_, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(readFileSync('./index.html'));
}).listen(port, () => console.log('serving on ' + port));`,
);

console.log("starting server (background)…");
await client.commands.runBackground("PORT=3000 node server.mjs");
await new Promise((r) => setTimeout(r, 2500));

console.log("minting preview token…");
const hostToken = await sdk.hosts.createToken(sandbox.id, {
  expiresAt: new Date(Date.now() + 3600_000),
});
const url = sdk.hosts.getUrl({ sandboxId: sandbox.id, token: hostToken.token }, 3000);
console.log("preview url:", url);

console.log("fetching preview…");
const res = await fetch(url);
const body = await res.text();
console.log("status:", res.status, "| contains marker:", body.includes("PHANTOM sandbox is live"));

console.log("shutting down…");
await sdk.sandboxes.shutdown(sandbox.id).catch(() => {});
console.log("done");
