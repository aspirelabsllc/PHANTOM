import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectDaemon, type ProjectRow } from "@/lib/daemon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Attach point for the live view: makes sure the daemon is up and returns the
// signed control URL + auth the browser uses for SSE, interrupt, and rewind.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: project } = await supabase
    .from("phantom_projects")
    .select("id, sandbox_id, daemon_secret, brand, offerings, chosen_variant")
    .eq("id", id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const handle = await ensureProjectDaemon(project as ProjectRow);
    return NextResponse.json({ ok: true, url: handle.url, auth: handle.secret });
  } catch (err) {
    const message = err instanceof Error ? err.message : "The chamber would not open.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
