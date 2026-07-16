// Verify the image plugin runs INSIDE a sandbox VM: clone it like
// ensureBuilder does, confirm its shell dependencies exist, then generate one
// real image per provider with the keys in env (the trade-off Salman chose).
// Run: node scripts/plugin-img-smoke.mjs
import { readFileSync } from "node:fs";
import { CodeSandbox } from "@codesandbox/sdk";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
for (const k of ["CSB_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY"]) {
  if (!process.env[k]) throw new Error(`${k} missing`);
}

const sdk = new CodeSandbox(process.env.CSB_API_KEY);
console.log("creating sandbox…");
const sb = await sdk.sandboxes.create();
console.log("id:", sb.id);
const client = await sb.connect();

const dir = "$HOME/.phantom-plugins";
await client.commands.run(
  [
    `mkdir -p ${dir}`,
    `test -d ${dir}/claude-image-generation/.git || git clone --depth 1 --single-branch -q https://github.com/hex/claude-image-generation ${dir}/claude-image-generation`,
  ].join(" ; "),
);
const deps = await client.commands.run("which jq bash curl base64 | tr '\\n' ' '");
console.log("shell deps:", deps.trim());

const env = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  XAI_API_KEY: process.env.XAI_API_KEY,
};

async function gen(script, out) {
  try {
    const res = await client.commands.run(
      `mkdir -p public/assets && bash ${dir}/claude-image-generation/scripts/${script} --mode generate ` +
        `--prompt "tiny minimalist test swatch, one teal dot on charcoal, flat vector" ` +
        `--output public/assets/${out} && stat -c '%s' public/assets/${out}`,
      { env },
    );
    const size = Number(res.trim().split("\n").pop());
    console.log(`  ${script}: ${size > 1000 ? `ok — ${(size / 1024).toFixed(0)} KB` : `FAIL (${res.slice(-300)})`}`);
    return size > 1000;
  } catch (e) {
    console.log(`  ${script}: FAIL — ${String(e.message ?? e).slice(0, 300)}`);
    return false;
  }
}

console.log("generating via plugin scripts in-VM…");
const g = await gen("gemini.sh", "smoke-plugin-gemini.png");
const x = await gen("xai.sh", "smoke-plugin-xai.png");

await sdk.sandboxes.shutdown(sb.id).catch(() => {});
if (!g || !x) process.exit(1);
console.log("plugin-in-VM smoke: PASS");
