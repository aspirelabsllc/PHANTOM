import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { BrandSchema, type Brand, type Offering } from "@/lib/brand";

// The Phantom — the app's AI backbone, built on the Claude Agent SDK. One agent,
// custom tools, running server-side. Extraction reads the offerings from disk;
// refinement edits an existing brand. The same agent pattern extends into the
// Manifest sandbox later.

const MODEL = "claude-opus-4-8";

export type AgentLog = (verb: "READ" | "EXTRACT" | "WRITE" | "THINK", target: string) => void;

const EXTRACT_PROMPT = `You are the Phantom — an oracle that reads what remains of a brand and draws out its true form.
Read every offering file in the current working directory (use Read; use Glob to find them if needed), then call save_brand exactly once with the brand's identity.
Rules:
- Ground every field in the offerings. Never invent a hex, typeface, or rule not supported by what you were given.
- If a category is genuinely absent, use empty arrays / empty strings rather than fabricating.
- Write "essence" and "story" in a spare, evocative register — the brand as it truly is, not marketing copy.
- Favour the most load-bearing colors, faces, and rules over exhaustiveness.
After saving, reply with a single evocative sentence naming what the brand is.`;

function mergePrompt(current: Brand): string {
  return `You already drew this brand from earlier offerings. Here is the current brand record — it may include the invoker's own edits and refinements, which you must respect:

${JSON.stringify(current, null, 2)}

New offerings have arrived in the current working directory. Read every file there (use Read / Glob), then call save_brand ONCE with the COMPLETE updated brand.
Rules:
- PRESERVE the invoker's existing decisions. Do not discard or overwrite a field that is still valid — change only what the new offerings genuinely add or correct.
- Prefer additive changes (new color tokens, new rules) over replacement. Carry forward every field the new offerings don't touch.
- Keep every field populated.
After saving, reply with one sentence on what the new offerings added.`;
}

function refinePrompt(current: Brand, instruction: string): string {
  return `You are the Phantom, refining a brand you already drew. Here is the current brand record as JSON:

${JSON.stringify(current, null, 2)}

The invoker now says:
"${instruction}"

Apply their intent to the brand. Preserve every field you are not changing. Then call save_brand once with the COMPLETE updated brand (all fields, not a patch). Finally, reply with one short sentence describing what you changed.`;
}

// Build the save_brand tool + capture the result.
function brandServer(capture: (b: Brand) => void, onLog: AgentLog) {
  const saveBrand = tool(
    "save_brand",
    "Persist the brand's full identity. Call once with every field populated.",
    BrandSchema.shape,
    async (args) => {
      const parsed = BrandSchema.parse(args);
      capture(parsed);
      onLog("WRITE", `brand · ${parsed.name || "unnamed"}`);
      return { content: [{ type: "text", text: "The vault holds it." }] };
    },
  );
  return createSdkMcpServer({ name: "phantom", version: "1.0.0", tools: [saveBrand] });
}

function drainMessages(
  q: AsyncGenerable,
  onLog: AgentLog,
  onText?: (text: string) => void,
  failMsg = "The offerings could not be read into a form.",
) {
  return (async () => {
    for await (const m of q) {
      if (m.type === "assistant" && m.message) {
        for (const b of m.message.content) {
          if (b.type === "tool_use" && b.name === "Read") {
            const fp = (b.input as { file_path?: string })?.file_path;
            if (fp) onLog("READ", basename(fp));
          } else if (b.type === "text" && b.text && onText) {
            onText(b.text);
          }
        }
      } else if (m.type === "result" && m.subtype === "error") {
        throw new Error(failMsg);
      }
    }
  })();
}
type AsyncGenerable = AsyncIterable<{
  type: string;
  subtype?: string;
  message?: { content: { type: string; name?: string; input?: unknown; text?: string }[] };
}>;

// Extract a brand from offerings. Writes them to a temp dir the agent reads.
// When `current` is provided, the agent MERGES the new offerings into it
// (non-destructive re-extraction) rather than drawing from scratch.
export async function extractBrandAgent(
  offerings: Offering[],
  download: (path: string) => Promise<Uint8Array>,
  onLog: AgentLog,
  current: Brand | null = null,
): Promise<Brand> {
  // On a merge, read ONLY the new (undrawn) offerings — re-reading the originals
  // would resurrect data the invoker has since edited or refined away.
  const pending = offerings.filter((o) => o.extracted === false);
  const toRead = current && pending.length ? pending : offerings;

  const dir = await mkdtemp(join(tmpdir(), "phantom-"));
  try {
    for (const o of toRead) {
      try {
        await writeFile(join(dir, basename(o.path)), await download(o.path));
      } catch {
        // one unreadable offering shouldn't sink the extraction
      }
    }

    let brand: Brand | null = null;
    const server = brandServer((b) => (brand = b), onLog);

    const q = query({
      prompt: current ? mergePrompt(current) : EXTRACT_PROMPT,
      options: {
        model: MODEL,
        cwd: dir,
        systemPrompt: "You are the Phantom, a precise brand-extraction oracle.",
        mcpServers: { phantom: server },
        allowedTools: ["Read", "Glob", "mcp__phantom__save_brand"],
        disallowedTools: ["Bash", "Write", "Edit", "WebSearch", "WebFetch"],
        maxTurns: 20,
      },
    });
    await drainMessages(q as unknown as AsyncGenerable, onLog);

    if (!brand) throw new Error("The offerings could not be read into a form.");
    return brand;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Refine an existing brand from a natural-language instruction. Streams the
// Phantom's spoken reply through onText; returns the updated brand.
export async function refineBrandAgent(
  current: Brand,
  instruction: string,
  onLog: AgentLog,
  onText: (text: string) => void,
): Promise<Brand> {
  let brand: Brand | null = null;
  const server = brandServer((b) => (brand = b), onLog);

  const q = query({
    prompt: refinePrompt(current, instruction),
    options: {
      model: MODEL,
      systemPrompt: "You are the Phantom, refining a brand with a careful hand.",
      mcpServers: { phantom: server },
      allowedTools: ["mcp__phantom__save_brand"],
      disallowedTools: ["Bash", "Read", "Write", "Edit", "WebSearch", "WebFetch"],
      maxTurns: 6,
    },
  });
  await drainMessages(q as unknown as AsyncGenerable, onLog, onText, "The refinement did not take.");

  // The agent may answer conversationally without changing anything — that's fine.
  return brand ?? current;
}
