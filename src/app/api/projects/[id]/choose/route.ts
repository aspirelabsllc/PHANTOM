import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { connectSandbox, writeClaudeMd } from "@/lib/sandbox";
import { VARIANTS, type Brand, type Variant } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Claim one of the three apparitions as THE site. The others stay on disk,
// switchable in the chamber; build turns from now on address only the chosen
// form. Claiming null re-opens the summons (all three heed again).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { variant } = (await req.json()) as { variant?: Variant | null };
  if (variant != null && !VARIANTS.includes(variant)) {
    return NextResponse.json({ error: "bad variant" }, { status: 400 });
  }

  const { data: project } = await supabase
    .from("phantom_projects")
    .select("id, sandbox_id, brand")
    .eq("id", id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { error } = await supabase
    .from("phantom_projects")
    .update({ chosen_variant: variant ?? null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // refresh the VM's CLAUDE.md so the claim is written law (best-effort — the
  // per-message context note carries it to the live session either way)
  if (project.sandbox_id) {
    connectSandbox(project.sandbox_id)
      .then(({ client }) => writeClaudeMd(client, project.brand as Brand | null, variant ?? null))
      .catch(() => {});
  }

  return NextResponse.json({ ok: true, chosen_variant: variant ?? null });
}
