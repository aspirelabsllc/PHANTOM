import { createClient } from "@/lib/supabase/server";
import type { Project } from "@/lib/brand";

// Server-only data access for phantom projects. RLS scopes every query to the
// signed-in owner, so these are safe to call from Server Components / routes.

export async function getProjects(): Promise<Project[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("phantom_projects")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Project[];
}

export async function getProject(id: string): Promise<Project | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("phantom_projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Project) ?? null;
}

// One persisted build-chat event. Ordered by `seq`; content shape depends on
// role/kind (user → {text}; phantom say → {reply,logs}; phantom error → {message}).
export type StoredMessage = {
  role: "user" | "phantom";
  kind: "say" | "log" | "error";
  content: {
    text?: string;
    reply?: string;
    logs?: { verb?: string; target?: string }[];
    message?: string;
    variant?: string; // which apparition spoke (absent on legacy single-lane rows)
  };
};

export async function getMessages(projectId: string): Promise<StoredMessage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("phantom_messages")
    .select("role, kind, content")
    .eq("project_id", projectId)
    .order("seq", { ascending: true });
  if (error) throw error;
  return (data ?? []) as StoredMessage[];
}

// One daemon event as the transcript consumes it (persisted or live SSE).
export type PhantomEvent = {
  seq: number;
  turn_id: string | null;
  type: string;
  payload: Record<string, unknown>;
};

export async function getEvents(projectId: string): Promise<PhantomEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("phantom_events")
    .select("seq, turn_id, type, payload")
    .eq("project_id", projectId)
    .order("seq", { ascending: true })
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as PhantomEvent[];
}
