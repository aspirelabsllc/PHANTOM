import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProject, getMessages } from "@/lib/projects";
import { Manifest } from "@/components/manifest/manifest";

export default async function ManifestProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const project = await getProject(id); // RLS → null if not owner
  if (!project) notFound();

  const messages = await getMessages(id); // durable build-chat transcript

  return (
    <div style={{ height: "100vh", overflow: "hidden" }}>
      <Manifest project={project} initialMessages={messages} />
    </div>
  );
}
