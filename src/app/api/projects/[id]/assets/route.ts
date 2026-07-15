import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, OFFERINGS_BUCKET } from "@/lib/supabase/admin";
import { buildAssetFiles, safeFileName, syncProjectAssets } from "@/lib/assets";
import { deriveAssetType, type Brand, type Offering } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function kindOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > -1 ? name.slice(dot + 1).toUpperCase() : "FILE";
}

async function ownedProject(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, project: null, unauthorized: true as const };
  const { data: project } = await supabase
    .from("phantom_projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return { supabase, project, unauthorized: false as const };
}

// The brand handoff — the stable contract the Manifest sandbox initializes from
// and re-fetches to stay in sync: the brand record + classified, signed assets.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { project, unauthorized } = await ownedProject(id);
  if (unauthorized) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const brand = (project.brand as Brand | null) ?? null;
  const offerings = (project.offerings as Offering[]) ?? [];
  const files = await buildAssetFiles(offerings, brand);

  return NextResponse.json({
    id: project.id,
    name: brand?.name ?? project.name,
    state: project.state,
    updated_at: project.updated_at,
    brand,
    assets: files.map((f) => ({
      name: f.file,
      path: f.path,
      size: f.size,
      kind: kindOf(f.file),
      assetType: f.type,
      face: f.face,
      origin: f.origin,
      note: f.note,
      url: f.url,
    })),
    signed_ttl: 3600,
  });
}

// Add assets straight into the vault from the Manifest panel. They land in
// storage, in the offerings record, and (best-effort) in the VM's
// public/assets/ so the agent can be told to use them immediately.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { supabase, project, unauthorized } = await ownedProject(id);
  if (unauthorized) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return NextResponse.json({ error: "no files" }, { status: 400 });

  const admin = createAdminClient();
  const added: Offering[] = [];
  for (const file of files) {
    const path = `${id}/${randomUUID()}-${safeFileName(file.name)}`;
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
      extracted: true, // panel additions are site assets, not brand sources
      assetType: deriveAssetType(file.name),
      origin: "offered",
    });
  }

  const offerings = [...((project.offerings as Offering[]) ?? []), ...added];
  const { error: upErr } = await supabase
    .from("phantom_projects")
    .update({ offerings, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  await syncProjectAssets(project.sandbox_id as string | null, offerings, project.brand as Brand | null);
  return NextResponse.json({ added: added.length });
}

// Remove an asset from the vault — and from the VM's public/assets/, so the
// site stops shipping it. Pages that still reference it will show a gap until
// the Phantom is asked to mend it.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "no path" }, { status: 400 });
  if (!path.startsWith(`${id}/`)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { supabase, project, unauthorized } = await ownedProject(id);
  if (unauthorized) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const admin = createAdminClient();
  await admin.storage.from(OFFERINGS_BUCKET).remove([path]);

  const offerings = ((project.offerings as Offering[]) ?? []).filter((o) => o.path !== path);
  const { error } = await supabase
    .from("phantom_projects")
    .update({ offerings, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await syncProjectAssets(project.sandbox_id as string | null, offerings, project.brand as Brand | null);
  return NextResponse.json({ ok: true });
}
