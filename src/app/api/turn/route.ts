import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken } from "@/lib/gateway-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { VARIANTS, type Variant } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A runner reports its finished turn from INSIDE the VM. This is the durable
// persistence path: the HTTP route that spawned the runner may be long dead
// (Railway cuts streams at 15 minutes), but this call always lands — the
// apparition's words, its session, and the turn's completion state survive.

type TurnReport = {
  variant?: Variant;
  session?: string;
  reply?: string;
  logs?: { verb?: string; target?: string }[];
  error?: string | null;
};

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : (req.headers.get("x-api-key") ?? "");
  const session = verifySessionToken(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const projectId = session.projectId;

  const body = ((await req.json().catch(() => ({}))) as TurnReport) ?? {};
  const variant = body.variant;
  if (!variant || !VARIANTS.includes(variant)) {
    return NextResponse.json({ error: "bad variant" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("phantom_projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const logs = (Array.isArray(body.logs) ? body.logs : [])
    .slice(0, 300)
    .map((l) => ({ verb: String(l?.verb ?? "").slice(0, 40), target: String(l?.target ?? "").slice(0, 160) }));
  const content = body.error
    ? { variant, message: String(body.error).slice(0, 500) }
    : { variant, reply: String(body.reply ?? "").slice(0, 20000), logs };

  const { error: insErr } = await admin.from("phantom_messages").insert({
    project_id: projectId,
    role: "phantom",
    kind: body.error ? "error" : "say",
    content,
  });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  // merge the session + mark this variant done; clears `building` when the
  // last expected variant reports (atomic — row lock serializes finishers)
  const { error: finErr } = await admin.rpc("phantom_finish_variant", {
    pid: projectId,
    v: variant,
    sess: body.session ?? "",
  });
  if (finErr) return NextResponse.json({ error: finErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
