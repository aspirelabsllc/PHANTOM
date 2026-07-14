import Link from "next/link";
import { frameDomain, frameMeta, type Project } from "@/lib/brand";
import { Thumb, accentOf } from "./thumb";

const STATE_META: Record<Project["state"], { frame: string; state: string; dot: string }> = {
  manifested: { frame: "is-live", state: "st-live", dot: "ecto breathe" },
  condensing: { frame: "is-forming", state: "st-form", dot: "cyan breathe" },
  dormant: { frame: "is-dormant", state: "st-dorm", dot: "dim" },
};

export function Frame({ project, delay }: { project: Project; delay: number }) {
  const s = STATE_META[project.state];
  const name = project.brand?.name ?? project.name;
  return (
    <Link
      className={`frame ${s.frame} manifest`}
      style={{ ["--d" as string]: delay }}
      // once a brand is manifested it opens straight into the manifest workspace;
      // still-forming / dormant brands go back to the invocation to finish extraction
      href={project.state === "manifested" ? `/manifest/${project.id}` : `/invocation/${project.id}`}
    >
      <Thumb name={name} accent={accentOf(project.brand)} />
      <div className="frame-meta">
        <h2>{name}</h2>
        <div className={`state ${s.state}`}>
          <span className={`dot ${s.dot}`} />
          {frameMeta(project)}
        </div>
        {project.state === "condensing" && (
          <div className="condense-bar" aria-hidden="true">
            <span className="fill" style={{ width: `${project.progress}%` }} />
          </div>
        )}
        <div className="domain">{frameDomain(project)}</div>
      </div>
    </Link>
  );
}
