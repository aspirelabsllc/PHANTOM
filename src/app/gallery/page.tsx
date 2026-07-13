import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProjects } from "@/lib/projects";
import { LabNav } from "@/components/gallery/nav";
import { Summon } from "@/components/gallery/summon";
import { Frame } from "@/components/gallery/frame";

export const dynamic = "force-dynamic";

export default async function GalleryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const invoker = (user.email ?? "invoker").split("@")[0];
  const phantoms = await getProjects();

  const manifested = phantoms.filter((p) => p.state === "manifested").length;
  const condensing = phantoms.filter((p) => p.state === "condensing").length;
  const dormant = phantoms.filter((p) => p.state === "dormant").length;

  return (
    <div className="gallery-body">
      <LabNav invoker={invoker} />

      <main className="gallery-wrap">
        <header className="gallery-head">
          <div className="kicker readout mono manifest" style={{ ["--d" as string]: 0 }}>
            <span className="tick" />
            <span>
              THE&nbsp;GALLERY&nbsp;OF&nbsp;FORMS&nbsp;·&nbsp;
              {phantoms.length === 0
                ? "THE VEIL IS EMPTY"
                : `${phantoms.length} PHANTOMS HELD`}
            </span>
          </div>
          {phantoms.length === 0 ? (
            <>
              <h1 className="manifest aberrate" style={{ ["--d" as string]: 1 }}>
                Nothing has crossed over <em>yet.</em>
              </h1>
              <p className="sub manifest" style={{ ["--d" as string]: 2 }}>
                The vapor is still. Begin an invocation and the first form will condense out
                of it.
              </p>
            </>
          ) : (
            <>
              <h1 className="manifest aberrate" style={{ ["--d" as string]: 1 }}>
                Your phantoms, <em>as they stand tonight.</em>
              </h1>
              <p className="sub manifest" style={{ ["--d" as string]: 2 }}>
                The ones that crossed over hold their shape in the world. Some are still
                condensing. The rest sleep in the vapor, waiting to be invoked again.
              </p>
            </>
          )}
        </header>

        <section className="frames" aria-label="Projects">
          <Summon delay={3} />
          {phantoms.map((p, i) => (
            <Frame key={p.id} project={p} delay={4 + i} />
          ))}
        </section>

        <footer className="gallery-foot">
          <span className="mono manifest" style={{ ["--d" as string]: 9 }}>
            {phantoms.length === 0 ? (
              <>GALLERY&nbsp;·&nbsp;AWAITING&nbsp;THE&nbsp;FIRST&nbsp;INVOCATION</>
            ) : (
              <>
                GALLERY&nbsp;·&nbsp;{manifested}&nbsp;<span className="ecto">MANIFESTED</span>&nbsp;·&nbsp;
                {condensing}&nbsp;<span className="lit">CONDENSING</span>&nbsp;·&nbsp;{dormant}&nbsp;DORMANT
              </>
            )}
          </span>
          <span className="mono manifest" style={{ ["--d" as string]: 10 }}>
            ALL&nbsp;FORMS&nbsp;ARE&nbsp;HELD&nbsp;·&nbsp;NOTHING&nbsp;IS&nbsp;LOST
          </span>
        </footer>
      </main>
    </div>
  );
}
