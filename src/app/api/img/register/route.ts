import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { verifySessionToken } from "@/lib/gateway-token";
import { createAdminClient, OFFERINGS_BUCKET } from "@/lib/supabase/admin";
import { safeFileName } from "@/lib/assets";
import { deriveAssetType, type Offering } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Reverse asset registration — the VM's register-assets.mjs posts files the
// agent conjured into public/assets/ (via the image plugin) so they land in
// the project's vault: stored in Supabase, listed in the panel, and safe from
// sync-assets.mjs pruning.

const MAX_BYTES = 20 * 1024 * 1024; // matches the bucket's per-object ceiling

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
};

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : (req.headers.get("x-api-key") ?? "");
  const session = verifySessionToken(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const projectId = session.projectId;

  const { file = "", b64 = "", note } = ((await req.json().catch(() => ({}))) as {
    file?: string;
    b64?: string;
    note?: string;
  }) ?? {};
  const name = safeFileName(file);
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (!name || !MIME[ext]) {
    return NextResponse.json({ error: "unsupported file type" }, { status: 400 });
  }
  const bytes = Buffer.from(b64, "base64");
  if (!bytes.length || bytes.length > MAX_BYTES) {
    return NextResponse.json({ error: "empty or oversized file" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("phantom_projects")
    .select("id, offerings")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  // already registered under this name? treat as done (idempotent re-runs)
  const offerings = (project.offerings as Offering[]) ?? [];
  if (offerings.some((o) => safeFileName(o.name) === name)) {
    return NextResponse.json({ file: name, existed: true });
  }

  const path = `${projectId}/conjured/${randomUUID()}-${name}`;
  const { error: upErr } = await admin.storage
    .from(OFFERINGS_BUCKET)
    .upload(path, bytes, { contentType: MIME[ext], upsert: false });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const offering: Offering = {
    name,
    size: bytes.length,
    path,
    kind: ext.toUpperCase(),
    extracted: true, // conjured assets carry no brand facts to draw
    assetType: deriveAssetType(name),
    origin: "conjured",
    ...(note ? { note: note.slice(0, 200) } : {}),
  };
  // atomic append — concurrent apparitions register at the same time
  const { error: rpcErr } = await admin.rpc("phantom_append_offering", {
    pid: projectId,
    off: offering,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  return NextResponse.json({ file: name });
}
