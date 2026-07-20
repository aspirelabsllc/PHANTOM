// Repro chamber-boot 137: fresh VM + starter package.json + npm install, with specs.
import { readFileSync } from "node:fs";
import { CodeSandbox } from "@codesandbox/sdk";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const sdk = new CodeSandbox(process.env.CSB_API_KEY);
const sandbox = await sdk.sandboxes.create();
console.log("sandbox:", sandbox.id);
const client = await sandbox.connect();

console.log("--- specs ---");
console.log(await client.commands.run("nproc; free -m | head -2; df -h /project 2>/dev/null | tail -1; node -v; npm -v"));

const pkg = {
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
};
await client.fs.writeTextFile("package.json", JSON.stringify(pkg, null, 2));

console.log("--- npm install ---");
try {
  const out = await client.commands.run("npm install --no-audit --no-fund 2>&1 | tail -8; echo NPMEXIT:$?");
  console.log(out);
} catch (e) {
  console.log("RUN THREW:", (e?.message || String(e)).slice(0, 300));
}
console.log("--- post ---");
try {
  console.log(await client.commands.run("free -m | head -2; ls node_modules 2>/dev/null | wc -l"));
} catch (e) {
  console.log("post check threw:", (e?.message || String(e)).slice(0, 200));
}

await sdk.sandboxes.shutdown(sandbox.id).catch(() => {});
console.log("done (shut down)");
