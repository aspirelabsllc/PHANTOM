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
    .select("id, sandbox_id, brand, agent_session_id")
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

      // accumulate the turn so it can be persisted durably (survives reload)
      const accLogs: { verb?: string; target?: string }[] = [];
      let accReply = "";
      let accError: string | null = null;
      let sessionId: string | null = null;
      let phantomSaved = false;
      const savePhantom = async () => {
        if (phantomSaved) return;
        phantomSaved = true;
        const content = accError ? { message: accError } : { reply: accReply, logs: accLogs };
        await supabase.from("phantom_messages").insert({
          project_id: id,
          role: "phantom",
          kind: accError ? "error" : "say",
          content,
        });
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
        const cmd = await client.commands.runBackground("node agent-runner.mjs", {
          env: {
            ANTHROPIC_BASE_URL: gateway,
            ANTHROPIC_API_KEY: token,
            IS_SANDBOX: "1", // CSB VMs run as root; let Claude Code bypass permissions
            PHANTOM_PROMPT: say,
            PHANTOM_BRAND: JSON.stringify((project.brand as Brand | null) ?? {}),
            // resume the prior Agent SDK session so the Phantom recalls the conversation
            ...(project.agent_session_id
              ? { PHANTOM_SESSION: project.agent_session_id as string }
              : {}),
          },
        });

        const timer = setInterval(beat, 4000);
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
            send({ t: "log", verb: m.verb, target: m.target });
            accLogs.push({ verb: m.verb, target: m.target });
          } else if (m.t === "text" && m.text) {
            send({ t: "say", text: m.text });
            accReply += (accReply ? " " : "") + m.text;
          } else if (m.t === "session" && m.id) {
            sessionId = m.id;
          } else if (m.t === "error") {
            send({ t: "error", message: m.message });
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

        clearInterval(timer);
        if (buf) handle(buf);
        await savePhantom();
        const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (sessionId && sessionId !== project.agent_session_id) upd.agent_session_id = sessionId;
        await supabase.from("phantom_projects").update(upd).eq("id", id);
        send({ t: "done" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "The build slipped away.";
        send({ t: "error", message });
        accError = accError ?? message;
        await savePhantom().catch(() => {});
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
