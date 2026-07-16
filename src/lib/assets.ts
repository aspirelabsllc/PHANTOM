import { createAdminClient, OFFERINGS_BUCKET } from "@/lib/supabase/admin";
import { connectSandbox, syncAssets } from "@/lib/sandbox";
import { assetTypeOf, type AssetFile, type Brand, type Offering } from "@/lib/brand";

export const SIGNED_TTL = 3600; // 1 hour

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Which typeface a font file carries, matched against the extracted pairing.
export function inferFace(name: string, brand: Brand | null): "display" | "body" | undefined {
  if (!brand) return undefined;
  const n = norm(name);
  const d = norm(brand.type?.display?.name ?? "");
  const b = norm(brand.type?.body?.name ?? "");
  if (d && n.includes(d)) return "display";
  if (b && n.includes(b)) return "body";
  return undefined;
}

export function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

// The vault snapshot as files: classified offerings with signed URLs and
// collision-free filenames — what the VM's public/assets/ should contain.
export async function buildAssetFiles(offerings: Offering[], brand: Brand | null): Promise<AssetFile[]> {
  const admin = createAdminClient();
  const taken = new Set<string>();
  const unique = (name: string): string => {
    let file = safeFileName(name);
    if (taken.has(file)) {
      const dot = file.lastIndexOf(".");
      const stem = dot > -1 ? file.slice(0, dot) : file;
      const ext = dot > -1 ? file.slice(dot) : "";
      let i = 2;
      while (taken.has(`${stem}-${i}${ext}`)) i++;
      file = `${stem}-${i}${ext}`;
    }
    taken.add(file);
    return file;
  };

  return Promise.all(
    offerings.map(async (o) => {
      const type = assetTypeOf(o);
      const { data } = await admin.storage.from(OFFERINGS_BUCKET).createSignedUrl(o.path, SIGNED_TTL);
      return {
        file: unique(o.name),
        url: data?.signedUrl ?? null,
        type,
        face: type === "font" ? inferFace(o.name, brand) : undefined,
        origin: o.origin ?? "offered",
        note: o.note,
        path: o.path,
        size: o.size,
      };
    }),
  );
}

// Best-effort: push the current vault into a project's VM. Never throws —
// the VM may be hibernated or gone; the next boot/build resyncs anyway.
export async function syncProjectAssets(
  sandboxId: string | null,
  offerings: Offering[],
  brand: Brand | null,
): Promise<void> {
  if (!sandboxId) return;
  try {
    const files = await buildAssetFiles(offerings, brand);
    const { client } = await connectSandbox(sandboxId);
    // additive only — this runs on every boot/reload with no register pass
    // before it, so pruning here would delete conjured imagery not yet in the
    // vault. The build path prunes (after register) to drop truly-removed files.
    await syncAssets(client, files, false);
  } catch {
    // sync is opportunistic; boot/build paths reconcile later
  }
}
