import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProject } from "@/lib/projects";
import { LabNav } from "@/components/gallery/nav";
import { Invocation } from "@/components/invocation/invocation";

export default async function InvocationProjectPage({
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

  const project = await getProject(id); // RLS returns null if not the owner
  if (!project) notFound();

  const invoker = (user.email ?? "invoker").split("@")[0];

  return (
    <div style={{ height: "100vh", overflow: "hidden" }}>
      <LabNav
        invoker={invoker}
        current="invocation"
        status={
          <span className="mono" style={{ fontSize: "9.5px" }}>
            INVOCATION · <b>{(project.brand?.name ?? project.name).toUpperCase()}</b>
          </span>
        }
      />
      <Invocation project={project} />
    </div>
  );
}
