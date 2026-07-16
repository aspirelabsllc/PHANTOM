import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { killDaemon, connectSandbox } from "@/lib/sandbox";
import {
  resolvePlugins,
  toStored,
  isValidPluginName,
  isValidPluginRepo,
  DEFAULT_PLUGINS,
  type Plugin,
} from "@/lib/plugins";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The per-project plugin registry. GET returns the resolved set (built-ins +
// custom); PUT replaces it and kills the daemon so it respawns with the new
// plugin set + freshly cloned repos on the next word.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: project } = await supabase
    .from("phantom_projects")
    .select("plugins")
    .eq("id", id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ plugins: resolvePlugins(project.plugins) });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { plugins?: Partial<Plugin>[] };
  const incoming = Array.isArray(body.plugins) ? body.plugins : [];

  // validate every custom entry; built-ins keep their fixed repo, user sets only enabled
  const defaults = new Set(DEFAULT_PLUGINS.map((d) => d.name));
  for (const p of incoming) {
    const name = String(p.name ?? "");
    if (defaults.has(name)) continue;
    if (!isValidPluginName(name)) {
      return NextResponse.json({ error: `invalid plugin name: ${name}` }, { status: 400 });
    }
    if (!isValidPluginRepo(String(p.repo ?? ""))) {
      return NextResponse.json(
        { error: `invalid repo for ${name} (must be a github/gitlab/bitbucket https URL)` },
        { status: 400 },
      );
    }
  }
  if (incoming.length > 24) {
    return NextResponse.json({ error: "too many plugins" }, { status: 400 });
  }

  const resolved = resolvePlugins(incoming);
  const stored = toStored(resolved);

  const { data: project } = await supabase
    .from("phantom_projects")
    .select("id, sandbox_id")
    .eq("id", id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { error } = await supabase
    .from("phantom_projects")
    .update({ plugins: stored })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // respawn the daemon so the new plugin set takes effect (it reads
  // PHANTOM_PLUGINS at spawn; ensureBuilder re-clones on the next attach/say)
  if (project.sandbox_id) {
    try {
      const { client } = await connectSandbox(project.sandbox_id);
      await killDaemon(client);
    } catch {
      // VM asleep/gone — the next boot spawns fresh with the stored set anyway
    }
  }

  return NextResponse.json({ ok: true, plugins: resolved });
}
