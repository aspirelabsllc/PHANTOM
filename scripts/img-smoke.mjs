// Verify the image gateway end to end against a running app: mint a session
// token, conjure one image per provider into a throwaway project, confirm the
// vault registration, then clean up. Run: node scripts/img-smoke.mjs [baseUrl]
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const base = process.argv[2] || "http://localhost:3000";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// borrow an owner so the FK holds, then make a throwaway project
const { data: donor } = await admin.from("phantom_projects").select("owner").limit(1).maybeSingle();
if (!donor) throw new Error("no existing project to borrow an owner from");
const { data: proj, error: insErr } = await admin
  .from("phantom_projects")
  .insert({ owner: donor.owner, name: "__img-smoke__" })
  .select("id")
  .single();
if (insErr) throw insErr;
const pid = proj.id;
console.log("throwaway project:", pid);

const payload = `${pid}.${Date.now() + 10 * 60 * 1000}`;
const sig = createHmac("sha256", process.env.GATEWAY_SECRET).update(payload).digest("base64url");
const token = `pht_${payload}.${sig}`;

async function conjure(provider) {
  const t0 = Date.now();
  const res = await fetch(`${base}/api/img`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      provider,
      prompt: "a tiny minimalist test swatch: one soft teal circle on a dark charcoal background, flat vector style",
      name: `smoke-${provider}`,
      aspect: "1:1",
    }),
  });
  const body = await res.json().catch(() => ({}));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!res.ok) {
    console.log(`  ${provider}: FAIL HTTP ${res.status} — ${body.error ?? "?"} (${secs}s)`);
    return false;
  }
  console.log(`  ${provider}: ok — ${body.file}, ${(Buffer.from(body.b64, "base64").length / 1024).toFixed(0)} KB (${secs}s)`);
  return true;
}

console.log("conjuring…");
const g = await conjure("gemini");
const x = await conjure("grok");

const { data: after } = await admin.from("phantom_projects").select("offerings").eq("id", pid).single();
const offs = after?.offerings ?? [];
console.log(
  "vault registered:",
  offs.length,
  "offerings —",
  offs.map((o) => `${o.name} (${o.origin})`).join(", ") || "none",
);

// cleanup: storage objects + project row
const paths = offs.map((o) => o.path).filter(Boolean);
if (paths.length) await admin.storage.from("phantom-offerings").remove(paths);
await admin.from("phantom_projects").delete().eq("id", pid);
console.log("cleaned up");
if (!g || !x) process.exit(1);
console.log("img gateway smoke: PASS");
