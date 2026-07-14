import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { bootSandbox, connectSandbox, ensureBuilder } from "@/lib/sandbox";
import { mintSessionToken } from "@/lib/gateway-token";
import type { Brand } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// A build turn: the invoker speaks, the Phantom agent (running inside the
// sandbox, reaching Anthropic only through our gateway) edits the site. The
// agent's tool calls and words stream to the chat; Vite HMR updates the preview.
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
    .select("id, sandbox_id, brand")
    .eq("id", id)
    .maybeSingle();
  if (!project) return new Response("not found", { status: 404 });

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
        const cmd = await client.commands.runBackground("node agent-runner.mjs", {
          env: {
            ANTHROPIC_BASE_URL: gateway,
            ANTHROPIC_API_KEY: token,
            IS_SANDBOX: "1", // CSB VMs run as root; let Claude Code bypass permissions
            PHANTOM_PROMPT: say,
            PHANTOM_BRAND: JSON.stringify((project.brand as Brand | null) ?? {}),
          },
        });

        const timer = setInterval(beat, 4000);
        let buf = "";
        const handle = (line: string) => {
          const s = line.trim();
          if (!s) return;
          let m: { t?: string; verb?: string; target?: string; text?: string; message?: string };
          try {
            m = JSON.parse(s);
          } catch {
            return; // ignore non-JSON stdout noise
          }
          if (m.t === "tool") send({ t: "log", verb: m.verb, target: m.target });
          else if (m.t === "text" && m.text) send({ t: "say", text: m.text });
          else if (m.t === "error") send({ t: "error", message: m.message });
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

        clearInterval(timer);
        if (buf) handle(buf);
        await supabase.from("phantom_projects").update({ updated_at: new Date().toISOString() }).eq("id", id);
        send({ t: "done" });
      } catch (err) {
        send({ t: "error", message: err instanceof Error ? err.message : "The build slipped away." });
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
