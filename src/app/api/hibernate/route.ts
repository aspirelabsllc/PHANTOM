import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken } from "@/lib/gateway-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { shutdownSandbox } from "@/lib/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The daemon calls home here when its chamber has been idle long enough —
// nobody attached, no turn running, nothing queued. We shut the VM down so
// dormant projects stop holding CodeSandbox concurrent-VM slots (the workspace
// cap is small, and a full cap blocks every other project from booting).
// Files persist through shutdown; the next Manifest open resumes the VM.
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : (req.headers.get("x-api-key") ?? "");
  const session = verifySessionToken(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("phantom_projects")
    .select("id, sandbox_id")
    .eq("id", session.projectId)
    .maybeSingle();
  if (!project?.sandbox_id) return NextResponse.json({ ok: true, note: "no sandbox" });

  try {
    await shutdownSandbox(project.sandbox_id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "shutdown failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
