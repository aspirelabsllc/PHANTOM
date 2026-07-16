import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectDaemon, daemonEndpoint, type ProjectRow } from "@/lib/daemon";
import { buildAssetFiles } from "@/lib/assets";
import { syncAssets } from "@/lib/sandbox";
import type { Brand, Offering } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Speak to the Phantom. Ensures the sandbox + daemon are alive, lays the
// vault's assets on disk, then forwards the message (with a fresh gateway
// token) to the daemon's queue. The live view flows browser → daemon SSE,
// never through this route — it returns as soon as the word is queued.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    text?: string;
    images?: { media_type?: string; data?: string }[];
  };
  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "Say what to build." }, { status: 400 });

  const { data: project } = await supabase
    .from("phantom_projects")
    .select("id, sandbox_id, daemon_secret, brand, offerings, chosen_variant, plugins")
    .eq("id", id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const handle = await ensureProjectDaemon(project as ProjectRow);

    // catch imagery a crashed turn left unregistered (sync would prune it),
    // then lay the vault's assets on disk before the agents reach for them
    try {
      await handle.client.commands.run("node register-assets.mjs", {
        env: {
          ANTHROPIC_BASE_URL: `${process.env.APP_URL}/api/gw`,
          ANTHROPIC_API_KEY: handle.token,
        },
      });
      const files = await buildAssetFiles(
        (project.offerings as Offering[]) ?? [],
        project.brand as Brand | null,
      );
      await syncAssets(handle.client, files);
    } catch {
      // sync is opportunistic; the daemon's register pass reconciles later
    }

    const chosen = project.chosen_variant;
    const context = chosen
      ? `The invoker has claimed apparition "${chosen}" (designs/${chosen}/) — it is THE site; address it alone.`
      : "No apparition is claimed — the summons is open: this word goes to all three forms (parallel design-builder subagents).";

    const res = await fetch(daemonEndpoint(handle, "/say"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-phantom-auth": handle.secret },
      body: JSON.stringify({
        text,
        token: handle.token,
        context,
        images: (body.images ?? []).slice(0, 4),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`daemon refused the word: HTTP ${res.status} ${detail.slice(0, 200)}`);
    }
    const out = (await res.json()) as { id?: string; seq?: number };

    return NextResponse.json({
      ok: true,
      turn: out.id ?? null,
      seq: out.seq ?? null,
      daemon: { url: handle.url, auth: handle.secret },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "The word did not reach the chamber.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
