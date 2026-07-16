// Daemon smoke: boots a throwaway sandbox, installs the builder toolchain,
// starts phantom-daemon.mjs pointed at the PRODUCTION gateway (APP_URL must
// be deployed + share GATEWAY_SECRET), then exercises the control surface:
// health, say → SSE events → result, interrupt, checkpoints, state.
// Run: node scripts/daemon-smoke.mjs [projectId]
import { readFileSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import { CodeSandbox } from "@codesandbox/sdk";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

// Compile the daemon + builder scripts from the TS sources via a tiny extract:
// we import the built strings through tsx-free hackery — simplest is to read
// the TS file and eval the template. Instead: re-use the app's own compiled
// behavior by fetching the daemon source from the repo files directly.
const daemonTs = readFileSync(new URL("../src/lib/vm/daemon-source.ts", import.meta.url), "utf8");
const versionMatch = daemonTs.match(/DAEMON_VERSION = "([^"]+)"/);
const srcMatch = daemonTs.match(/DAEMON_SOURCE = `([\s\S]*)`;\s*$/m);
if (!srcMatch) throw new Error("could not extract DAEMON_SOURCE");
const DAEMON_SOURCE = srcMatch[1].replaceAll("${DAEMON_VERSION}", versionMatch[1]);

const APP_URL = process.env.APP_URL;
const projectId = process.argv[2] || "00000000-0000-0000-0000-000000000000";

function mintToken(pid) {
  const payload = `${pid}.${Date.now() + 24 * 3600 * 1000}`;
  const sig = createHmac("sha256", process.env.GATEWAY_SECRET).update(payload).digest("base64url");
  return `pht_${payload}.${sig}`;
}

const secret = randomBytes(16).toString("base64url");
const token = mintToken(projectId);

const sdk = new CodeSandbox(process.env.CSB_API_KEY);
console.log("creating sandbox…");
const sb = await sdk.sandboxes.create();
console.log("id:", sb.id);
const client = await sb.connect();

// minimal site + daemon
await client.fs.writeTextFile("package.json", JSON.stringify({ name: "smoke", private: true, type: "module" }));
await client.fs.writeTextFile("index.html", "<!doctype html><title>smoke</title>");
await client.fs.writeTextFile("phantom-daemon.mjs", DAEMON_SOURCE);
await client.fs.writeTextFile("CLAUDE.md", "# smoke test site\nA scratch site for a daemon smoke test.");
console.log("installing agent sdk…");
await client.commands.run("npm install @anthropic-ai/claude-agent-sdk@0.3.207 2>&1 | tail -1");
await client.commands.run("git init -q -b main; git config user.email s@s; git config user.name s; git add -A; git commit -qm init");

console.log("starting daemon…");
await client.commands.runBackground("node phantom-daemon.mjs", {
  env: {
    IS_SANDBOX: "1",
    ANTHROPIC_BASE_URL: `${APP_URL}/api/gw`,
    ANTHROPIC_API_KEY: token,
    PHANTOM_ORIGIN: APP_URL,
    PHANTOM_DAEMON_SECRET: secret,
    PHANTOM_PROJECT: projectId,
  },
});

for (let i = 0; i < 15; i++) {
  const h = await client.commands.run("curl -sf -m 2 http://localhost:8787/health || echo down");
  if (h.includes('"ok":true')) break;
  await new Promise((r) => setTimeout(r, 1000));
}
console.log("health:", await client.commands.run("curl -s http://localhost:8787/health"));

const hostToken = await sdk.hosts.createToken(sb.id, { expiresAt: new Date(Date.now() + 3600_000) });
const base = sdk.hosts.getUrl({ sandboxId: sb.id, token: hostToken.token }, 8787);
const ep = (path, params = {}) => {
  const u = new URL(base);
  u.pathname = path;
  u.searchParams.set("auth", secret);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
};

// auth gate
const unauth = await fetch(new URL("/state", base));
console.log("unauth /state →", unauth.status, "(want 401)");

// SSE attach BEFORE the say, collect events
const events = [];
const ac = new AbortController();
const ssePromise = (async () => {
  const res = await fetch(ep("/events", { after: "0" }), { signal: ac.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const p of parts) {
      const line = p.split("\n").find((l) => l.startsWith("data: "));
      if (line) {
        try { events.push(JSON.parse(line.slice(6))); } catch {}
      }
    }
  }
})().catch(() => {});

// say — tiny task, no subagents
const say = await fetch(ep("/say"), {
  method: "POST",
  headers: { "content-type": "application/json", "x-phantom-auth": secret },
  body: JSON.stringify({
    text: "Create a file named hello.txt containing exactly: the phantom lives. Use the Write tool once, then reply with one short sentence. Do not use Task subagents.",
    token,
  }),
});
console.log("say →", say.status, await say.text());

// wait for a result event (up to 4 min)
const t0 = Date.now();
let result = null;
while (Date.now() - t0 < 240_000) {
  result = events.find((e) => e.type === "result");
  if (result) break;
  await new Promise((r) => setTimeout(r, 2000));
}
ac.abort();
await ssePromise;

console.log("--- event types seen:", [...new Set(events.map((e) => e.type))].join(", "));
console.log("--- events:", events.length);
const text = events.filter((e) => e.type === "text").map((e) => e.payload.text).join(" | ");
console.log("--- phantom said:", text.slice(0, 300));
console.log("--- result:", result ? JSON.stringify(result.payload) : "NONE (timed out)");
console.log("--- file check:", JSON.stringify(await client.commands.run("cat hello.txt 2>&1")));
console.log("--- checkpoints:", await client.commands.run(`curl -s -H 'x-phantom-auth: ${secret}' http://localhost:8787/checkpoints`));
console.log("--- state:", await client.commands.run(`curl -s -H 'x-phantom-auth: ${secret}' http://localhost:8787/state`));
console.log("--- daemon events persisted to DB: check phantom_events for", projectId);

await sdk.sandboxes.shutdown(sb.id).catch(() => {});
console.log("done");
