import { createHmac, timingSafeEqual } from "node:crypto";

// Short-lived, stateless session tokens for the sandbox agent. HMAC-signed so
// the gateway (dev or prod, sharing GATEWAY_SECRET) can validate without a DB
// round-trip. The real Anthropic key never leaves our backend.

const TTL_MS = 2 * 60 * 60 * 1000; // 2h build session
const DAEMON_TTL_MS = 24 * 60 * 60 * 1000; // 24h daemon lease; refreshed on every /say

function sign(payload: string): string {
  return createHmac("sha256", process.env.GATEWAY_SECRET!).update(payload).digest("base64url");
}

export function mintSessionToken(projectId: string, kind: "build" | "daemon" = "build"): string {
  const ttl = kind === "daemon" ? DAEMON_TTL_MS : TTL_MS;
  const payload = `${projectId}.${Date.now() + ttl}`;
  return `pht_${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string): { projectId: string } | null {
  if (!token?.startsWith("pht_")) return null;
  const rest = token.slice(4);
  const i = rest.lastIndexOf(".");
  if (i < 0) return null;
  const payload = rest.slice(0, i);
  const sig = rest.slice(i + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [projectId, expStr] = payload.split(".");
  if (!projectId || !expStr || Date.now() > Number(expStr)) return null;
  return { projectId };
}
