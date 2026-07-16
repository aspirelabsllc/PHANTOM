// Verify the VM-side turn reporting path: /api/turn inserts the apparition's
// message, merges its session, and clears `building` only when every expected
// variant has reported. Run with the app up: node scripts/turn-smoke.mjs [baseUrl]
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

const { data: donor } = await admin.from("phantom_projects").select("owner").limit(1).maybeSingle();
const { data: proj } = await admin
  .from("phantom_projects")
  .insert({
    owner: donor.owner,
    name: "__turn-smoke__",
    building: { started_at: new Date().toISOString(), expect: ["one", "two"], got: [] },
  })
  .select("id")
  .single();
const pid = proj.id;
console.log("throwaway project:", pid);

const payload = `${pid}.${Date.now() + 600000}`;
const sig = createHmac("sha256", process.env.GATEWAY_SECRET).update(payload).digest("base64url");
const token = `pht_${payload}.${sig}`;

async function report(variant, body) {
  const res = await fetch(`${base}/api/turn`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ variant, ...body }),
  });
  return res.status;
}
async function state() {
  const { data } = await admin
    .from("phantom_projects")
    .select("building, agent_sessions")
    .eq("id", pid)
    .single();
  return data;
}

const s1 = await report("one", {
  session: "sess-one",
  reply: "Design one settles.",
  logs: [{ verb: "Write", target: "designs/one/index.html" }],
});
const st1 = await state();
console.log(
  "after one:",
  s1,
  "| got:",
  JSON.stringify(st1.building?.got),
  "| sessions:",
  JSON.stringify(st1.agent_sessions),
);

const s2 = await report("two", { session: "sess-two", error: "It faltered." });
const st2 = await state();
console.log("after two:", s2, "| building:", JSON.stringify(st2.building), "| sessions:", JSON.stringify(st2.agent_sessions));

const { data: msgs } = await admin
  .from("phantom_messages")
  .select("kind, content")
  .eq("project_id", pid)
  .order("seq");
console.log("rows:", msgs.map((m) => `${m.kind}[${m.content.variant}]`).join(", "));

const pass =
  s1 === 200 &&
  s2 === 200 &&
  JSON.stringify(st1.building?.got) === '["one"]' &&
  st2.building === null &&
  st2.agent_sessions.one === "sess-one" &&
  st2.agent_sessions.two === "sess-two" &&
  msgs.length === 2 &&
  msgs[0].kind === "say" &&
  msgs[1].kind === "error";

await admin.from("phantom_projects").delete().eq("id", pid);
console.log("cleaned up");
console.log(pass ? "turn smoke: PASS" : "turn smoke: FAIL");
if (!pass) process.exit(1);
