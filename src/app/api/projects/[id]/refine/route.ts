import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { refineBrandAgent } from "@/lib/phantom-agent";
import { type Brand } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Conversational refinement: the invoker speaks, the Phantom edits the brand.
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
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!project) return new Response("not found", { status: 404 });

  const current = project.brand as Brand | null;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      try {
        if (!current) {
          send({ t: "error", message: "There is nothing to refine yet — extract a brand first." });
          return;
        }
        if (!say) {
          send({ t: "error", message: "Say something to the Phantom." });
          return;
        }

        const brand = await refineBrandAgent(
          current,
          say,
          (verb, target) => send({ t: "log", verb, target }),
          (text) => send({ t: "say", text }),
        );

        await supabase
          .from("phantom_projects")
          .update({
            brand,
            name: brand.name || project.name,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id);

        send({ t: "done", brand });
      } catch (err) {
        send({ t: "error", message: err instanceof Error ? err.message : "The refinement slipped away." });
      } finally {
        closed = true;
        controller.close();
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
