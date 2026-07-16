import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  bootSandbox,
  connectSandbox,
  ensureBuilder,
  ensureDaemon,
  daemonHostUrl,
  writeClaudeMd,
  type SbClient,
} from "@/lib/sandbox";
import { mintSessionToken } from "@/lib/gateway-token";
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
};

export type DaemonHandle = {
  client: SbClient;
  sandboxId: string;
  secret: string;
  url: string; // signed browser-reachable control URL
  token: string; // fresh daemon-kind gateway token
  created: boolean;
};

export async function ensureProjectDaemon(project: ProjectRow): Promise<DaemonHandle> {
  const admin = createAdminClient();

  // control secret — minted once per project, shared app <-> daemon <-> browser
  let secret = project.daemon_secret;
  if (!secret) {
    secret = randomBytes(24).toString("base64url");
    await admin.from("phantom_projects").update({ daemon_secret: secret }).eq("id", project.id);
  }

  // sandbox — boot or wake
  const boot = await bootSandbox(project.sandbox_id ?? null);
  if (boot.created || boot.sandboxId !== project.sandbox_id) {
    await admin
      .from("phantom_projects")
      .update({
        sandbox_id: boot.sandboxId,
        ...(boot.created ? { agent_session_id: null, agent_sessions: {} } : {}),
      })
      .eq("id", project.id);
  }

  const { client } = await connectSandbox(boot.sandboxId);
  await ensureBuilder(client);
  await writeClaudeMd(client, project.brand ?? null, project.chosen_variant ?? null);

  const token = mintSessionToken(project.id, "daemon");
  await ensureDaemon(client, { token, secret, projectId: project.id });

  const url = await daemonHostUrl(boot.sandboxId);
  return { client, sandboxId: boot.sandboxId, secret, url, token, created: boot.created };
}
