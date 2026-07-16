import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Durable transcript history for the Manifest chat. RLS scopes to the owner.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const after = Number(req.nextUrl.searchParams.get("after") ?? 0);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("phantom_events")
    .select("seq, turn_id, type, payload")
    .eq("project_id", id)
    .gt("seq", Number.isFinite(after) ? after : 0)
    .order("seq", { ascending: true })
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ events: data ?? [] });
}
