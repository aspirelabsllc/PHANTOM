// Peek project rows (id, name, state, sandbox_id). Usage: node scripts/peek-projects.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const { data, error } = await admin
  .from("phantom_projects")
  .select("id, name, state, sandbox_id, chosen_variant")
  .order("created_at", { ascending: false });
if (error) throw error;
for (const p of data) console.log(p.id, "|", p.name, "|", p.state, "| sandbox:", p.sandbox_id, "| chosen:", p.chosen_variant);
