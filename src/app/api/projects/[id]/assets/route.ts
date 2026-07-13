import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, OFFERINGS_BUCKET } from "@/lib/supabase/admin";
import { assetTypeOf, type Brand, type Offering } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNED_TTL = 3600; // 1 hour

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Which typeface a font file carries, matched against the extracted pairing.
function inferFace(name: string, brand: Brand | null): "display" | "body" | undefined {
  if (!brand) return undefined;
  const n = norm(name);
  const d = norm(brand.type?.display?.name ?? "");
  const b = norm(brand.type?.body?.name ?? "");
  if (d && n.includes(d)) return "display";
  if (b && n.includes(b)) return "body";
  return undefined;
}

// The brand handoff — the stable contract the Manifest sandbox initializes from
// and re-fetches to stay in sync: the brand record + classified, signed assets.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: project } = await supabase
    .from("phantom_projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const brand = (project.brand as Brand | null) ?? null;
  const offerings = (project.offerings as Offering[]) ?? [];
  const admin = createAdminClient();

  const assets = await Promise.all(
    offerings.map(async (o) => {
      const type = assetTypeOf(o);
      const { data } = await admin.storage.from(OFFERINGS_BUCKET).createSignedUrl(o.path, SIGNED_TTL);
      return {
        name: o.name,
        path: o.path,
        kind: o.kind,
        size: o.size,
        assetType: type,
        face: type === "font" ? inferFace(o.name, brand) : undefined,
        url: data?.signedUrl ?? null,
      };
    }),
  );

  return NextResponse.json({
    id: project.id,
    name: brand?.name ?? project.name,
    state: project.state,
    updated_at: project.updated_at,
    brand,
    assets,
    signed_ttl: SIGNED_TTL,
  });
}
