import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { bootSandbox, connectSandbox, ensureBuilder, syncAssets, AGENT_PLUGIN_NAMES, type SbClient } from "@/lib/sandbox";
import { buildAssetFiles } from "@/lib/assets";
import { mintSessionToken } from "@/lib/gateway-token";
import { VARIANTS, VARIANT_META, type Brand, type Offering, type Variant } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The two art directions the faithful apparitions diverge along on the first
// summon; the third apparition is unbound and invents its own.
const DIRECTIONS: Partial<Record<Variant, string>> = {
  one: "Editorial restraint — generous whitespace, an asymmetric grid, a type-led hero, quiet motion. Let the brand breathe.",
  two: "Immersive boldness — full-bleed imagery, layered depth, oversized display type, confident use of the accent color. Let the brand perform.",
};

// A build turn: the invoker speaks, the Phantom agents (running inside the
// sandbox, reaching Anthropic only through our gateway) edit the site. Before
// a form is claimed, all three apparitions heed every word in parallel; after
// claiming, only the chosen one builds. Tool calls and words stream to the
// chat tagged by variant; Vite HMR updates the preview.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const say = (req.nextUrl.searchParams.get("say") ?? "").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("unauthenticated", { status: 401 });

  const { data: project } = await supabase
    .from("phantom_projects")
    .select("id, sandbox_id, brand, offerings, chosen_variant, agent_sessions")
    .eq("id", id)
    .maybeSingle();
  if (!project) return new Response("not found", { status: 404 });

  const chosen = (project.chosen_variant as Variant | null) ?? null;
  const targets: Variant[] = chosen ? [chosen] : [...VARIANTS];
  const sessions: Partial<Record<Variant, string>> = {
    ...((project.agent_sessions as Partial<Record<Variant, string>>) ?? {}),
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (o: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(o)}\n\n`));
      };
      const beat = () => {
        if (!closed) controller.enqueue(encoder.encode(`: keepalive\n\n`));
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      try {
        if (!say) {
          send({ t: "error", message: "Say what to build." });
          return finish();
        }

        // record the invoker's words durably before any work begins
        await supabase
          .from("phantom_messages")
          .insert({ project_id: id, role: "user", kind: "say", content: { text: say } });

        // ensure a sandbox exists
        let sandboxId = project.sandbox_id as string | null;
        if (!sandboxId) {
          send({ t: "log", verb: "BOOT", target: "summoning the chamber…" });
          const boot = await bootSandbox(null);
          sandboxId = boot.sandboxId;
          await supabase.from("phantom_projects").update({ sandbox_id: sandboxId }).eq("id", id);
        }

        send({ t: "log", verb: "READ", target: "attuning the builder…" });
        const { client } = await connectSandbox(sandboxId);
        await ensureBuilder(client);

        const token = mintSessionToken(id);
        const gateway = `${process.env.APP_URL}/api/gw`;
        const gwEnv = { ANTHROPIC_BASE_URL: gateway, ANTHROPIC_API_KEY: token };

        // catch imagery a crashed turn left unregistered (sync would prune it),
        // then lay the vault's assets on disk before the agents reach for them
        try {
          await client.commands.run("node register-assets.mjs", { env: gwEnv });
          const files = await buildAssetFiles((project.offerings as Offering[]) ?? [], project.brand as Brand | null);
          await syncAssets(client, files);
        } catch {
          send({ t: "log", verb: "SYNC", target: "the vault would not fully sync — continuing" });
        }

        const brandJson = JSON.stringify((project.brand as Brand | null) ?? {});
        const timer = setInterval(beat, 4000);

        const runVariant = async (v: Variant): Promise<void> => {
          // each apparition accumulates + persists its own turn
          const accLogs: { verb?: string; target?: string }[] = [];
          let accReply = "";
          let accError: string | null = null;

          const cmd = await (client as SbClient).commands.runBackground("node agent-runner.mjs", {
            env: {
              ...gwEnv,
              IS_SANDBOX: "1", // CSB VMs run as root; let Claude Code bypass permissions
              // the image plugin's shell scripts call Gemini/xAI directly from
              // the VM (Salman's call: plugin fidelity over key isolation)
              ...(process.env.GEMINI_API_KEY ? { GEMINI_API_KEY: process.env.GEMINI_API_KEY } : {}),
              ...(process.env.XAI_API_KEY ? { XAI_API_KEY: process.env.XAI_API_KEY } : {}),
              PHANTOM_PROMPT: say,
              PHANTOM_BRAND: brandJson,
              PHANTOM_PLUGINS: AGENT_PLUGIN_NAMES,
              PHANTOM_VARIANT: v,
              PHANTOM_MODE: VARIANT_META[v].mode,
              // art direction only seeds the first summon; after that the
              // conversation itself steers each apparition
              ...(sessions[v] ? { PHANTOM_SESSION: sessions[v] } : { PHANTOM_DIRECTION: DIRECTIONS[v] ?? "" }),
            },
          });

          let buf = "";
          const handle = (line: string) => {
            const s = line.trim();
            if (!s) return;
            let m: { t?: string; verb?: string; target?: string; text?: string; message?: string; id?: string };
            try {
              m = JSON.parse(s);
            } catch {
              return; // ignore non-JSON stdout noise
            }
            if (m.t === "tool") {
              send({ t: "log", v, verb: m.verb, target: m.target });
              accLogs.push({ verb: m.verb, target: m.target });
            } else if (m.t === "text" && m.text) {
              send({ t: "say", v, text: m.text });
              accReply += (accReply ? " " : "") + m.text;
            } else if (m.t === "session" && m.id) {
              sessions[v] = m.id;
            } else if (m.t === "error") {
              send({ t: "error", v, message: m.message });
              accError = m.message ?? "The build faltered.";
            }
          };

          cmd.onOutput((chunk) => {
            buf += chunk;
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const l of lines) handle(l);
          });

          await new Promise<void>((resolve) => {
            cmd.onStatusChange((st) => {
              if (st === "FINISHED" || st === "ERROR" || st === "KILLED") resolve();
            });
          });
          if (buf) handle(buf);

          const content = accError
            ? { variant: v, message: accError }
            : { variant: v, reply: accReply, logs: accLogs };
          await supabase.from("phantom_messages").insert({
            project_id: id,
            role: "phantom",
            kind: accError ? "error" : "say",
            content,
          });
          send({ t: "variant-done", v });
        };

        await Promise.all(targets.map((v) => runVariant(v).catch(() => send({ t: "variant-done", v }))));

        // pull any plugin-conjured imagery into the vault
        await client.commands.run("node register-assets.mjs", { env: gwEnv }).catch(() => {});

        clearInterval(timer);
        await supabase
          .from("phantom_projects")
          .update({ agent_sessions: sessions, updated_at: new Date().toISOString() })
          .eq("id", id);
        send({ t: "done" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "The build slipped away.";
        send({ t: "error", message });
        await supabase
          .from("phantom_messages")
          .insert({ project_id: id, role: "phantom", kind: "error", content: { message } })
          .then(undefined, () => {});
      } finally {
        finish();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
