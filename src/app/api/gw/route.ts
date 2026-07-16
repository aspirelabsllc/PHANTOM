export const runtime = "nodejs";

// The Agent SDK preflights its base URL with a bare HEAD before talking to
// the API — answer politely instead of littering the logs with 404s.
export function HEAD() {
  return new Response(null, { status: 200 });
}
export function GET() {
  return new Response("the phantom gateway is listening", { status: 200 });
}
