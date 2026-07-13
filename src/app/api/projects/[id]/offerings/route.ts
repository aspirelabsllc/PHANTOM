import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, OFFERINGS_BUCKET } from "@/lib/supabase/admin";
import { deriveAssetType, ASSET_TYPES, type AssetType, type Offering } from "@/lib/brand";

export const runtime = "nodejs";

function kindOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > -1 ? name.slice(dot + 1).toUpperCase() : "FILE";
}
function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

// Upload one or more offerings into a project's vault.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // Ownership check (RLS also enforces this, but fail fast + clearly).
  const { data: project } = await supabase
    .from("phantom_projects")
    .select("id, offerings")
    .eq("id", id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return NextResponse.json({ error: "no files" }, { status: 400 });

  const admin = createAdminClient();
  const added: Offering[] = [];

  for (const file of files) {
    const path = `${id}/${randomUUID()}-${safeName(file.name)}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error } = await admin.storage
      .from(OFFERINGS_BUCKET)
      .upload(path, bytes, { contentType: file.type || "application/octet-stream", upsert: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    added.push({
      name: file.name,
      size: file.size,
      path,
      kind: kindOf(file.name),
      extracted: false,
      assetType: deriveAssetType(file.name),
    });
  }

  const offerings = [...((project.offerings as Offering[]) ?? []), ...added];
  const { error: upErr } = await supabase
    .from("phantom_projects")
    .update({ offerings, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ offerings: added });
}

// Remove an offering (by storage path) from the vault.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "no path" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: project } = await supabase
    .from("phantom_projects")
    .select("id, offerings")
    .eq("id", id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  // guard: the path must belong to this project (paths are `${id}/...`)
  if (!path.startsWith(`${id}/`)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const admin = createAdminClient();
  await admin.storage.from(OFFERINGS_BUCKET).remove([path]);

  const offerings = ((project.offerings as Offering[]) ?? []).filter((o) => o.path !== path);
  const { error } = await supabase
    .from("phantom_projects")
    .update({ offerings, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ offerings });
}

// Reclassify an offering (change its asset type for the Manifest handoff).
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { path, assetType } = (await req.json()) as { path?: string; assetType?: AssetType };
  if (!path || !assetType || !ASSET_TYPES.includes(assetType)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const { data: project } = await supabase
    .from("phantom_projects")
    .select("id, offerings")
    .eq("id", id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const offerings = ((project.offerings as Offering[]) ?? []).map((o) =>
    o.path === path ? { ...o, assetType } : o,
  );
  const { error } = await supabase
    .from("phantom_projects")
    .update({ offerings, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ offerings });
}
