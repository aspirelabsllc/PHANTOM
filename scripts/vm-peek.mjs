// Quick VM inspector: run an arbitrary command in a project VM.
// Usage: node scripts/vm-peek.mjs <sandboxId> "<command>"
import { readFileSync } from "node:fs";
import { CodeSandbox } from "@codesandbox/sdk";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const id = process.argv[2];
const cmd = process.argv[3] || "ls -la";
const sdk = new CodeSandbox(process.env.CSB_API_KEY);
const sb = await sdk.sandboxes.resume(id);
const c = await sb.connect();
const out = await c.commands.run(cmd);
// write + flush before exiting — a bare process.exit can drop buffered stdout
process.stdout.write(out + "\n", () => process.exit(0));
