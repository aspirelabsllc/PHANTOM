// Sweep the CSB workspace: list running VMs, shut them all down (they resume
// on next boot; site files persist). Usage: node scripts/vm-sweep.mjs [keepId]
import { readFileSync } from "node:fs";
import { CodeSandbox } from "@codesandbox/sdk";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const keep = process.argv[2] || null;
const sdk = new CodeSandbox(process.env.CSB_API_KEY);

const page = await sdk.sandboxes.list({ status: "running", pagination: { pageSize: 50 } });
const running = page.sandboxes ?? page;
console.log(`running VMs: ${running.length}`);
for (const sb of running) {
  const id = sb.id ?? sb;
  if (keep && id === keep) {
    console.log(`keep ${id}`);
    continue;
  }
  try {
    await sdk.sandboxes.shutdown(id);
    console.log(`shutdown ${id}`);
  } catch (e) {
    console.log(`FAILED ${id}: ${e?.message || e}`);
  }
}
console.log("done");
