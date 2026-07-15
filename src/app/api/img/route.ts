import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { verifySessionToken } from "@/lib/gateway-token";
import { createAdminClient, OFFERINGS_BUCKET } from "@/lib/supabase/admin";
import { safeFileName } from "@/lib/assets";
import type { Offering } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

// The image gateway — the sandbox agent's `image.mjs` posts here with its
// session token; the real Gemini/xAI keys live only on this server. The
// generated image is stored in the project's vault (so it appears in the
// panel and survives VM resets) and returned as base64 for the VM to write
// into public/assets/.

type ImgRequest = {
  provider?: "gemini" | "grok";
  prompt?: string;
  name?: string;
  aspect?: string;
};

const ASPECT_RE = /^(\d+(\.\d+)?):(\d+(\.\d+)?)$|^auto$/;

async function generateGemini(prompt: string, aspect: string): Promise<Buffer> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured");
  const model = "gemini-3-pro-image-preview";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: aspect === "auto" ? "1:1" : aspect, imageSize: "2K" },
        },
      }),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Gemini HTTP ${res.status}: ${body?.error?.message ?? "unknown error"}`);
  }
  type Part = { inlineData?: { data?: string }; text?: string };
  const parts: Part[] = body?.candidates?.[0]?.content?.parts ?? [];
  const b64 = parts.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!b64) {
    const said = parts.find((p) => p.text)?.text;
    throw new Error(`Gemini returned no image${said ? ` — model said: ${said.slice(0, 200)}` : ""}`);
  }
  return Buffer.from(b64, "base64");
}

async function generateGrok(prompt: string, aspect: string): Promise<Buffer> {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY is not configured");
  const res = await fetch("https://api.x.ai/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "grok-imagine-image-pro",
      prompt,
      n: 1,
      response_format: "b64_json",
      ...(aspect !== "auto" ? { aspect_ratio: aspect } : {}),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Grok HTTP ${res.status}: ${body?.error?.message ?? body?.error ?? "unknown error"}`);
  }
  const b64 = body?.data?.[0]?.b64_json;
  if (!b64) throw new Error("Grok returned no image");
  return Buffer.from(b64, "base64");
}

export async function POST(req: NextRequest) {
  // authenticated by the build session token, not a browser session
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : (req.headers.get("x-api-key") ?? "");
  const session = verifySessionToken(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const projectId = session.projectId;

  const { provider = "gemini", prompt = "", name = "conjured", aspect = "1:1" } =
    ((await req.json().catch(() => ({}))) as ImgRequest) ?? {};
  if (!prompt.trim()) return NextResponse.json({ error: "prompt required" }, { status: 400 });
  if (!["gemini", "grok"].includes(provider)) {
    return NextResponse.json({ error: "provider must be gemini or grok" }, { status: 400 });
  }
  if (!ASPECT_RE.test(aspect)) {
    return NextResponse.json({ error: "bad aspect (like 16:9, 1:1, 9:16, or auto)" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("phantom_projects")
    .select("id, offerings")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  let bytes: Buffer;
  try {
    bytes =
      provider === "grok"
        ? await generateGrok(prompt.trim(), aspect)
        : await generateGemini(prompt.trim(), aspect);
  } catch (err) {
    const message = err instanceof Error ? err.message : "generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // collision-free filename against the existing vault
  const taken = new Set(((project.offerings as Offering[]) ?? []).map((o) => safeFileName(o.name)));
  const stem = safeFileName(name).replace(/\.(png|jpg|jpeg|webp)$/i, "") || "conjured";
  let file = `${stem}.png`;
  for (let i = 2; taken.has(file); i++) file = `${stem}-${i}.png`;

  const path = `${projectId}/conjured/${randomUUID()}-${file}`;
  const { error: upErr } = await admin.storage
    .from(OFFERINGS_BUCKET)
    .upload(path, bytes, { contentType: "image/png", upsert: false });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const offering: Offering = {
    name: file,
    size: bytes.length,
    path,
    kind: "PNG",
    extracted: true, // conjured assets carry no brand facts to draw
    assetType: "image",
    origin: "conjured",
    note: prompt.trim().slice(0, 200),
  };
  // atomic append — concurrent apparitions conjure at the same time
  const { error: rpcErr } = await admin.rpc("phantom_append_offering", {
    pid: projectId,
    off: offering,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  return NextResponse.json({ file, mime: "image/png", b64: bytes.toString("base64") });
}
