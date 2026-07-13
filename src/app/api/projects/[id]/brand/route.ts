import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { BrandSchema } from "@/lib/brand";

export const runtime = "nodejs";

// Deterministic brand edit — save the full brand JSON straight from the editor.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let brand;
  try {
    const body = await req.json();
    brand = BrandSchema.parse(body.brand);
  } catch {
    return NextResponse.json({ error: "invalid brand" }, { status: 400 });
  }

  const { error } = await supabase
    .from("phantom_projects")
    .update({ brand, name: brand.name || undefined, updated_at: new Date().toISOString() })
    .eq("id", id); // RLS scopes to owner
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
