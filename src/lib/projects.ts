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
