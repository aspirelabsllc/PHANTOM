import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  bootProjectSandbox,
  connectSandbox,
  ensureBuilder,
  ensureDaemon,
  daemonHostUrl,
  writeClaudeMd,
  type SbClient,
} from "@/lib/sandbox";
import { mintSessionToken } from "@/lib/gateway-token";
import { resolvePlugins } from "@/lib/plugins";
import type { Brand, Offering, Variant } from "@/lib/brand";

// Server-side daemon bootstrap: make sure the project has a sandbox, the
// builder toolchain, a shared control secret, and a live daemon — then hand
// back everything a route (or the browser) needs to talk to it.

export type ProjectRow = {
  id: string;
  sandbox_id: string | null;
  daemon_secret: string | null;
  brand: Brand | null;
  offerings: Offering[] | null;
  chosen_variant: Variant | null;
  plugins?: unknown; // stored plugin registry (null = built-in defaults)
};

export type DaemonHandle = {
  client: SbClient;
  sandboxId: string;
  secret: string;
  url: string; // signed browser-reachable control URL
  token: string; // fresh daemon-kind gateway token
  created: boolean;
};

// One daemon-ensure in flight per project: concurrent /daemon attaches (or a
// /daemon racing a /say) share the same bootstrap instead of doubling up the
// builder/daemon setup work on the VM.
const ensureFlights = new Map<string, Promise<DaemonHandle>>();
// The whole bootstrap races a hard budget. A wedged VM can hang a CSB exec
// call forever; without this the flight never settles, stays in the map, and
// every later attach joins the same zombie promise until the process restarts.
const ENSURE_BUDGET_MS = 240_000;
export function ensureProjectDaemon(project: ProjectRow): Promise<DaemonHandle> {
  const inflight = ensureFlights.get(project.id);
  if (inflight) return inflight;
  const flight = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("The chamber took too long to attune — try again.")),
        ENSURE_BUDGET_MS,
      );
    });
    try {
      return await Promise.race([ensureProjectDaemonInner(project), timeout]);
    } finally {
      clearTimeout(timer);
      ensureFlights.delete(project.id);
    }
  })();
  ensureFlights.set(project.id, flight);
  return flight;
}

async function ensureProjectDaemonInner(project: ProjectRow): Promise<DaemonHandle> {
  const admin = createAdminClient();

  // control secret — minted once per project, shared app <-> daemon <-> browser
  let secret = project.daemon_secret;
  if (!secret) {
    secret = randomBytes(24).toString("base64url");
    await admin.from("phantom_projects").update({ daemon_secret: secret }).eq("id", project.id);
  }

  // sandbox — boot or wake (persist a fresh VM's id immediately so a failed
  // boot never strands it; see bootSandbox)
  const boot = await bootProjectSandbox(project.id, project.sandbox_id ?? null, async (newId) => {
    await admin.from("phantom_projects").update({ sandbox_id: newId }).eq("id", project.id);
  });
  if (boot.created || boot.sandboxId !== project.sandbox_id) {
    await admin.from("phantom_projects").update({ sandbox_id: boot.sandboxId }).eq("id", project.id);
  }

  const plugins = resolvePlugins(project.plugins);
  const { client } = await connectSandbox(boot.sandboxId);
  await ensureBuilder(client, plugins);
  await writeClaudeMd(client, project.brand ?? null, project.chosen_variant ?? null);

  // the current DB max seq — a fresh VM's daemon seeds from this so its event
  // stream never collides with events an earlier VM already persisted
  const { data: top } = await admin
    .from("phantom_events")
    .select("seq")
    .eq("project_id", project.id)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  const seqBase = (top?.seq as number | undefined) ?? 0;

  const token = mintSessionToken(project.id, "daemon");
  await ensureDaemon(client, { token, secret, projectId: project.id, seqBase, plugins });

  const url = await daemonHostUrl(boot.sandboxId);
  return { client, sandboxId: boot.sandboxId, secret, url, token, created: boot.created };
}

// Build a control endpoint on the signed host URL without clobbering its
// query string (the CSB preview token lives there).
export function daemonEndpoint(handle: Pick<DaemonHandle, "url" | "secret">, path: string): string {
  const u = new URL(handle.url);
  u.pathname = path;
  return u.toString();
}
