import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { bootSandbox } from "@/lib/sandbox";
import { syncProjectAssets } from "@/lib/assets";
import type { Brand, Offering } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Boot (or wake) the project's Manifest sandbox and return a live preview URL.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: project } = await supabase
    .from("phantom_projects")
    .select("id, sandbox_id, offerings, brand")
    .eq("id", id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const { sandboxId, previewUrl, created } = await bootSandbox(project.sandbox_id ?? null);
    if (created || sandboxId !== project.sandbox_id) {
      // a freshly created VM has no ~/.claude transcripts → old session ids are
      // stale and would make `resume` fail, so drop them with the new sandbox id
      await supabase
        .from("phantom_projects")
        .update({
          sandbox_id: sandboxId,
          ...(created ? { agent_session_id: null, agent_sessions: {} } : {}),
        })
        .eq("id", id);
    }
    // opportunistically push the vault's assets into the VM (never blocks boot)
    syncProjectAssets(sandboxId, (project.offerings as Offering[]) ?? [], project.brand as Brand | null).catch(
      () => {},
    );
    return NextResponse.json({ previewUrl, sandboxId, created });
  } catch (err) {
    const message = err instanceof Error ? err.message : "The chamber would not open.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
