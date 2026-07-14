import { type NextRequest } from "next/server";
import { Agent, fetch as undiciFetch } from "undici";
import { verifySessionToken } from "@/lib/gateway-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ANTHROPIC = "https://api.anthropic.com";

// A model turn can stream for minutes; undici's default 300s body/headers
// timeouts would abort a long response mid-stream ("connection closed
// mid-response"). Disable them so the proxy holds the stream open as long as
// Anthropic keeps sending.
const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

// The LLM gateway. The sandbox agent points ANTHROPIC_BASE_URL here and sends a
// short-lived session token as its key. We validate it, swap in the real
// ANTHROPIC_API_KEY, and stream Anthropic's response straight back — so the key
// never enters the sandbox.
async function proxy(req: NextRequest, path: string[]) {
  const token = req.headers.get("x-api-key") ?? req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token || !verifySessionToken(token)) {
    return new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid session token" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const url = `${ANTHROPIC}/${path.join("/")}${req.nextUrl.search}`;
  const headers = new Headers();
  // forward Anthropic-relevant headers, swap the key
  for (const h of ["anthropic-version", "anthropic-beta", "content-type", "accept"]) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set("x-api-key", process.env.ANTHROPIC_API_KEY!);

  const method = req.method;
  const body = method === "GET" || method === "HEAD" ? undefined : await req.text();

  const upstream = await undiciFetch(url, { method, headers, body, dispatcher });

  // pass the (possibly streaming) response straight through
  const respHeaders = new Headers();
  for (const h of ["content-type", "cache-control", "anthropic-ratelimit-requests-remaining"]) {
    const v = upstream.headers.get(h);
    if (v) respHeaders.set(h, v);
  }
  return new Response(upstream.body as unknown as ReadableStream, {
    status: upstream.status,
    headers: respHeaders,
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path);
}
export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path);
}
