import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, OFFERINGS_BUCKET } from "@/lib/supabase/admin";
import { extractBrandAgent } from "@/lib/phantom-agent";
import { categoriesDrawn, type Brand, type Offering } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Stream the extraction: READ offerings, draw the categories, WRITE the vault.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
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

  const offerings = (project.offerings as Offering[]) ?? [];
  const current = (project.brand as Brand | null) ?? null;
  const reExtract = !!current;
  const admin = createAdminClient();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      const beat = () => {
        if (closed) return;
        controller.enqueue(encoder.encode(`: keepalive\n\n`));
      };

      try {
        if (offerings.length === 0) {
          send({ t: "error", message: "No offerings to read. Offer something first." });
          controller.close();
          closed = true;
          return;
        }

        await supabase.from("phantom_projects").update({ state: "condensing", progress: 4 }).eq("id", id);

        const fresh = offerings.filter((o) => o.extracted === false).length;
        send({
          t: "phase",
          text: reExtract
            ? `${fresh || offerings.length} NEW OFFERING${(fresh || offerings.length) === 1 ? "" : "S"} · RE-READING THE VAULT`
            : `${offerings.length} OFFERING${offerings.length === 1 ? "" : "S"} RECEIVED · EXTRACTION BEGINS`,
        });
        send({ t: "progress", pct: 5 });

        // heartbeat + slow progress climb while the Phantom agent works
        let alive = 8;
        const timer = setInterval(() => {
          alive = Math.min(66, alive + 2);
          send({ t: "progress", pct: alive });
          beat();
        }, 1500);

        let brand: Brand;
        try {
          // The agent reads the offerings itself — its READ / WRITE tool calls
          // stream straight through to the log.
          brand = await extractBrandAgent(
            offerings,
            async (path) => {
              const { data, error } = await admin.storage.from(OFFERINGS_BUCKET).download(path);
              if (error || !data) throw new Error(error?.message ?? "download failed");
              return new Uint8Array(await data.arrayBuffer());
            },
            (verb, target) => send({ t: "log", verb, target }),
            current, // non-destructive merge when a brand already exists
          );
        } finally {
          clearInterval(timer);
        }

        // Draw each populated category — real data, sequenced for the condensing feel
        const steps: { node: string; verb: "EXTRACT"; target: string }[] = [];
        if (brand.story?.essence) steps.push({ node: "Story", verb: "EXTRACT", target: "story · brand essence" });
        if (brand.color?.tokens?.length)
          steps.push({ node: "Color", verb: "EXTRACT", target: `color-system · ${brand.color.tokens.length} tokens` });
        if (brand.type?.display?.name)
          steps.push({ node: "Type", verb: "EXTRACT", target: `type-pairing · ${brand.type.display.name} / ${brand.type.body?.name ?? "—"}` });
        if (brand.voice?.essence)
          steps.push({ node: "Voice", verb: "EXTRACT", target: `voice · ${brand.voice.prohibitions?.length ?? 0} prohibitions` });
        if (brand.logo?.facts?.length)
          steps.push({ node: "Logo", verb: "EXTRACT", target: `logo-rules · ${brand.logo.facts.length} held` });
        if (brand.usage?.rules?.length)
          steps.push({ node: "Usage", verb: "EXTRACT", target: `usage · ${brand.usage.rules.length} rules` });
        steps.push({ node: "Assets", verb: "EXTRACT", target: `assets · ${offerings.length} files held` });
        if (brand.compliance?.rules?.length || brand.compliance?.note)
          steps.push({ node: "Compliance", verb: "EXTRACT", target: `compliance · ${brand.compliance.rules?.length ?? 0} hard rules` });

        let step = 0;
        for (const s of steps) {
          send({ t: "log", verb: s.verb, target: s.target });
          send({ t: "node", key: s.node });
          step++;
          send({ t: "progress", pct: 66 + Math.floor((step / steps.length) * 26) });
          await wait(240);
        }

        // WRITE the vault (the real persist)
        send({ t: "phase", text: `${categoriesDrawn(brand)} CATEGORIES HELD · THE VAULT IS FORMING`, lit: true });
        for (const f of ["brand/tokens.json", "brand/voice.md", "brand/logo.md", "brand/compliance.json"]) {
          send({ t: "log", verb: "WRITE", target: f });
          await wait(140);
        }

        // mark every offering as drawn into the brand
        const marked = offerings.map((o) => ({ ...o, extracted: true }));
        await supabase
          .from("phantom_projects")
          .update({
            brand,
            name: brand.name || project.name,
            state: "manifested",
            progress: 100,
            offerings: marked,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id);

        send({ t: "progress", pct: 100 });
        send({ t: "done", brand, name: brand.name });
      } catch (err) {
        const message = err instanceof Error ? err.message : "The veil would not part.";
        // non-destructive: a failed re-read leaves the existing brand intact
        await supabase
          .from("phantom_projects")
          .update({ state: reExtract ? "manifested" : "dormant", progress: reExtract ? 100 : 0 })
          .eq("id", id);
        send({ t: "error", message });
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
