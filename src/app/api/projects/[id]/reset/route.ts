import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resetSandboxFiles } from "@/lib/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Reset a project. scope=conversation clears the build chat + agent memory;
// scope=full also wipes the site back to the starter scaffold.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const scope = req.nextUrl.searchParams.get("scope") === "full" ? "full" : "conversation";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: project } = await supabase
    .from("phantom_projects")
    .select("id, sandbox_id")
    .eq("id", id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    // reset the site first (the slow part) so a failure leaves the chat intact;
    // resetSandboxFiles also kills any apparitions still building
    if (scope === "full" && project.sandbox_id) {
      await resetSandboxFiles(project.sandbox_id);
    }
    // clear the conversation + agent sessions in both cases; a full reset
    // also un-claims the chosen form and frees the chamber (the killed
    // agents' turn will never report home)
    await supabase.from("phantom_messages").delete().eq("project_id", id);
    await supabase
      .from("phantom_projects")
      .update({
        agent_session_id: null,
        agent_sessions: {},
        ...(scope === "full" ? { chosen_variant: null, building: null } : {}),
      })
      .eq("id", id);
    return NextResponse.json({ ok: true, scope });
  } catch (err) {
    const message = err instanceof Error ? err.message : "reset failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
