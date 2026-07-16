import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken } from "@/lib/gateway-token";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The daemon persists its event stream here (batched) — the durable half of
// the live view. Auth is the gateway session token; inserts are idempotent
// on (project_id, seq) so retried batches never duplicate.

type IncomingEvent = {
  seq?: number;
  turn_id?: string | null;
  type?: string;
  payload?: unknown;
};

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : (req.headers.get("x-api-key") ?? "");
  const session = verifySessionToken(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { events?: IncomingEvent[] };
  const events = (Array.isArray(body.events) ? body.events : [])
    .filter((e) => Number.isFinite(e?.seq) && typeof e?.type === "string")
    .slice(0, 200)
    .map((e) => ({
      project_id: session.projectId,
      seq: Math.floor(e.seq as number),
      turn_id: e.turn_id ? String(e.turn_id).slice(0, 60) : null,
      type: (e.type as string).slice(0, 40),
      payload: e.payload ?? {},
    }));
  if (!events.length) return NextResponse.json({ ok: true, inserted: 0 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("phantom_events")
    .upsert(events, { onConflict: "project_id,seq", ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, inserted: events.length });
}
