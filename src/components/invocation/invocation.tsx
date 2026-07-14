"use client";

import Link from "next/link";
import { Fragment, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApparitionField } from "@/components/apparition";
import { CategoryNodes } from "@/components/invocation/nodes";
import { ReplyMd } from "@/components/reply-md";
import {
  categoriesDrawn,
  pendingOfferings,
  type AssetType,
  type Brand,
  type Offering,
  type Project,
} from "@/lib/brand";

type LogRow = { verb: string; target: string; running?: boolean };
type PhaseRow = { text: string; lit?: boolean };
type Status = "idle" | "ready" | "uploading" | "extracting" | "manifested" | "error";

function ext(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > -1 ? name.slice(dot + 1).toUpperCase() : "FILE";
}
function fmtSize(b: number) {
  if (b > 1048576) return (b / 1048576).toFixed(1) + " MB";
  if (b > 1024) return Math.round(b / 1024) + " KB";
  return b + " B";
}

function litFromBrand(b: Brand | null, offerings: Offering[]): Set<string> {
  const s = new Set<string>();
  if (!b) return s;
  if (b.story?.essence) s.add("Story");
  if (b.color?.tokens?.length) s.add("Color");
  if (b.type?.display?.name) s.add("Type");
  if (b.voice?.essence) s.add("Voice");
  if (b.logo?.facts?.length) s.add("Logo");
  if (b.usage?.rules?.length) s.add("Usage");
  if (offerings.length) s.add("Assets");
  if (b.compliance?.rules?.length || b.compliance?.note) s.add("Compliance");
  return s;
}

const Sig = () => (
  <span className="sig">
    <i />
    <i />
    <i />
  </span>
);

export function Invocation({ project }: { project: Project }) {
  const router = useRouter();
  const [offerings, setOfferings] = useState<Offering[]>(project.offerings ?? []);
  const [brand, setBrand] = useState<Brand | null>(project.brand);
  const [lit, setLit] = useState<Set<string>>(() => litFromBrand(project.brand, project.offerings ?? []));
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [phases, setPhases] = useState<PhaseRow[]>([]);
  const [progress, setProgress] = useState(project.progress ?? 0);
  const [status, setStatus] = useState<Status>(
    project.state === "manifested" ? "manifested" : project.offerings?.length ? "ready" : "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  // conversational refinement
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<{ you: string; reply: string }[]>([]);
  const [pending, setPending] = useState<{ you: string; reply: string; logs: LogRow[] } | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);

  // inline editing
  const [editing, setEditing] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "held">("idle");
  const saveTimer = useRef<number | undefined>(undefined);

  const fileInput = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const depth = useRef(0);

  function updateBrand(fn: (b: Brand) => void) {
    setBrand((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev) as Brand;
      fn(next);
      setLit(litFromBrand(next, offerings));
      setSaveState("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(async () => {
        try {
          const res = await fetch(`/api/projects/${project.id}/brand`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ brand: next }),
          });
          setSaveState(res.ok ? "held" : "idle");
          if (res.ok) router.refresh();
        } catch {
          setSaveState("idle");
        }
      }, 700);
      return next;
    });
  }

  const drawn = brand ? categoriesDrawn(brand) : lit.size;
  const pendingCount = pendingOfferings(offerings).length;

  function scrollDown() {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  async function upload(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (!files.length) return;
    setUploading(true);
    setUploadingFiles(files.map((f) => f.name));
    setStatus((s) => (s === "manifested" ? s : "uploading"));
    scrollDown();
    try {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      const res = await fetch(`/api/projects/${project.id}/offerings`, { method: "POST", body: form });
      if (!res.ok) {
        setError("The offering was refused. Try again.");
        setStatus((s) => (s === "manifested" ? s : "error"));
        return;
      }
      const { offerings: added } = (await res.json()) as { offerings: Offering[] };
      setOfferings((prev) => [...prev, ...added]);
      setStatus((s) => (s === "manifested" ? s : "ready"));
      scrollDown();
    } finally {
      setUploading(false);
      setUploadingFiles([]);
    }
  }

  async function deleteOffering(path: string) {
    setOfferings((prev) => prev.filter((o) => o.path !== path));
    await fetch(`/api/projects/${project.id}/offerings?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    }).catch(() => {});
    router.refresh();
  }

  async function classify(path: string, assetType: AssetType) {
    setOfferings((prev) => prev.map((o) => (o.path === path ? { ...o, assetType } : o)));
    await fetch(`/api/projects/${project.id}/offerings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, assetType }),
    }).catch(() => {});
  }

  function extract() {
    if (!offerings.length || status === "extracting") return;
    const isRe = !!brand; // re-extraction merges; keep the current form on screen
    setStatus("extracting");
    setError(null);
    setLogs([]);
    setPhases([]);
    if (!isRe) {
      setLit(new Set());
      setBrand(null);
    }
    setProgress(2);

    const es = new EventSource(`/api/projects/${project.id}/extract`);
    es.onmessage = (e) => {
      const m = JSON.parse(e.data);
      switch (m.t) {
        case "log":
          setLogs((prev) => [...prev, { verb: m.verb, target: m.target, running: m.running }]);
          scrollDown();
          break;
        case "node":
          setLit((prev) => new Set(prev).add(m.key));
          break;
        case "phase":
          setPhases((prev) => [...prev, { text: m.text, lit: m.lit }]);
          scrollDown();
          break;
        case "progress":
          setProgress(m.pct);
          break;
        case "done":
          setBrand(m.brand as Brand);
          setOfferings((prev) => prev.map((o) => ({ ...o, extracted: true })));
          setLit(litFromBrand(m.brand as Brand, offerings));
          setStatus("manifested");
          setLogs((prev) => prev.map((l) => ({ ...l, running: false })));
          es.close();
          router.refresh();
          scrollDown();
          break;
        case "error":
          setError(m.message);
          setStatus("error");
          es.close();
          break;
      }
    };
    es.onerror = () => {
      es.close();
      setStatus((s) => {
        if (s === "extracting") {
          setError("The connection to the veil was lost.");
          return "error";
        }
        return s;
      });
    };
  }

  function startRefine(text: string) {
    const say = text.trim();
    if (!say || pending) return;
    setDraft("");
    setError(null);
    setPending({ you: say, reply: "", logs: [] });
    scrollDown();

    const es = new EventSource(`/api/projects/${project.id}/refine?say=${encodeURIComponent(say)}`);
    es.onmessage = (e) => {
      const m = JSON.parse(e.data);
      switch (m.t) {
        case "log":
          setPending((p) => (p ? { ...p, logs: [...p.logs, { verb: m.verb, target: m.target }] } : p));
          scrollDown();
          break;
        case "say":
          setPending((p) => (p ? { ...p, reply: (p.reply ? p.reply + " " : "") + m.text } : p));
          scrollDown();
          break;
        case "done":
          setBrand(m.brand as Brand);
          setLit(litFromBrand(m.brand as Brand, offerings));
          setPending((p) => {
            if (p) setTurns((t) => [...t, { you: p.you, reply: p.reply || "Held." }]);
            return null;
          });
          es.close();
          router.refresh();
          scrollDown();
          break;
        case "error":
          setPending((p) => {
            if (p) setTurns((t) => [...t, { you: p.you, reply: "" }]);
            return null;
          });
          setError(m.message);
          es.close();
          break;
      }
    };
    es.onerror = () => {
      es.close();
      setPending((p) => {
        if (p) {
          setError("The connection to the veil was lost.");
          setTurns((t) => [...t, { you: p.you, reply: "" }]);
        }
        return null;
      });
    };
  }

  const headState =
    status === "extracting"
      ? "EXTRACTING"
      : pending
        ? "REFINING"
        : status === "manifested"
          ? "MANIFESTED"
          : "AWAITING OFFERINGS";
  const stepNow = status === "manifested" ? "THRESHOLD" : status === "extracting" ? "EXTRACTION" : "OFFERING";

  return (
    <main className="invocation">
      {/* step rail */}
      <div className="step-rail manifest" style={{ ["--d" as string]: 0 }} aria-label="Invocation progress">
        <span className="step-id">INVOCATION · STEP 01</span>
        <span className="sep">—</span>
        <span className={`ph ${status !== "idle" ? "done" : ""}`}>OFFERING</span>
        <span className="sep">→</span>
        <span className={`ph ${stepNow === "EXTRACTION" ? "now" : status === "manifested" ? "done" : ""}`}>
          EXTRACTION
        </span>
        <span className="sep">→</span>
        <span className={`ph ${status === "manifested" ? "now" : ""}`}>THRESHOLD</span>
        <span className="spacer" />
        <span>THE VAULT IS FORMING · NOTHING IS LOST</span>
      </div>

      {/* left: extraction chamber */}
      <section className="extract-stage" aria-label="The apparition, ringed by extracted brand categories">
        <ApparitionField
          interactive={false}
          ariaHidden
          condenseDelay={900}
          options={{ count: 680, fade: 0.11, scale: 0.5, yShift: 0.02, shape: "sigil", kScale: 0.45 }}
        />

        <svg className="leaders" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <line x1="17" y1="20" x2="50" y2="46" />
          <line x1="12" y1="42" x2="50" y2="46" />
          <line x1="15" y1="66" x2="50" y2="46" />
          <line x1="31" y1="84" x2="50" y2="46" />
          <line x1="79" y1="22" x2="50" y2="46" />
          <line x1="85" y1="45" x2="50" y2="46" />
          <line x1="82" y1="68" x2="50" y2="46" />
          <line x1="63" y1="86" x2="50" y2="46" />
        </svg>

        <header className="stage-kicker">
          <div className="readout mono manifest" style={{ ["--d" as string]: 1 }}>
            <span className="tick" />
            <span>THE INVOCATION · {(brand?.name ?? project.name).toUpperCase()}</span>
          </div>
          <h1 className="manifest" style={{ ["--d" as string]: 2 }}>
            {brand?.name ?? "A brand"}, <em>as the offerings remember it.</em>
          </h1>
        </header>

        {brand && (
          <button
            type="button"
            className="edit-toggle"
            data-on={editing}
            onClick={() => setEditing((e) => !e)}
          >
            {editing ? "Editing" : "Edit brand"}
            {editing && (
              <span className={`save-state${saveState === "saving" ? " saving" : ""}`}>
                {saveState === "saving" ? "saving…" : saveState === "held" ? "held" : ""}
              </span>
            )}
          </button>
        )}

        <CategoryNodes
          brand={brand}
          lit={lit}
          offerings={offerings}
          editing={editing}
          update={updateBrand}
          onClassify={classify}
        />

        <footer className="stage-foot">
          <span className="mono manifest" style={{ ["--d" as string]: 13 }}>
            EXTRACTION <span className="lit">{progress}%</span> · {drawn} CATEGORIES DRAWN ·{" "}
            {offerings.length} OFFERINGS · {status === "extracting" ? "SIGNAL RISING" : "HELD"}
          </span>
        </footer>
      </section>

      {/* right: offering thread */}
      <aside
        className={`invoke-chat${over ? " over" : ""}`}
        aria-label="Conversation with the Phantom"
        onDragEnter={(e) => {
          e.preventDefault();
          depth.current++;
          setOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault();
          depth.current = Math.max(0, depth.current - 1);
          if (!depth.current) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          depth.current = 0;
          setOver(false);
          if (e.dataTransfer?.files?.length) upload(e.dataTransfer.files);
        }}
      >
        <div className="invoke-head">
          <span className="mono">
            PHANTOM · <span className="lit">{headState}</span>
          </span>
          <span className="mono" style={{ fontSize: "9px" }}>
            NOTHING IS LOST
          </span>
        </div>

        <div className="invoke-scroll" ref={scrollRef}>
          <div className="msg phantom manifest" style={{ ["--d" as string]: 2 }}>
            <span className="who">Phantom</span>
            <p className="voice-line">
              Bring me what remains of the brand — reports, marks, letterforms. I will listen to
              what they remember.
            </p>
            <p className="plain">
              Drop your offerings anywhere in this thread. HTML, PDF, SVG, images — the Phantom takes
              them all.
            </p>
          </div>

          {(offerings.length > 0 || uploadingFiles.length > 0) && (
            <div className="msg user">
              <span className="who">You</span>
              <div className="bubble">
                <span className="offer-chips">
                  {offerings.map((o, i) => (
                    <span className={`specimen${o.extracted === false ? " fresh" : ""}`} key={o.path || i}>
                      <span className="kind">{ext(o.name)}</span>
                      {o.name}
                      <span className="size">{fmtSize(o.size)}</span>
                      <button
                        className="specimen-del"
                        type="button"
                        onClick={() => deleteOffering(o.path)}
                        disabled={status === "extracting"}
                        aria-label={`remove ${o.name}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {uploadingFiles.map((name, i) => (
                    <span className="specimen uploading" key={`up-${i}`}>
                      <span className="mini-spin" aria-hidden="true" />
                      {name}
                      <span className="size">receiving…</span>
                    </span>
                  ))}
                </span>
              </div>
            </div>
          )}

          {phases[0] && (
            <div className={`extract-row${phases[0].lit ? " lit" : ""}`}>{phases[0].text}</div>
          )}

          {logs.length > 0 && (
            <div className="lab-log" role="log" aria-label="Extraction log">
              {logs.map((l, i) => (
                <div className={`log-row${l.running ? " running" : ""}`} key={i}>
                  <span className={`verb ${l.verb.toLowerCase()}`}>{l.verb}</span>
                  <span className="target">{l.target}</span>
                  <Sig />
                </div>
              ))}
            </div>
          )}

          {phases.slice(1).map((p, i) => (
            <div className={`extract-row${p.lit ? " lit" : ""}`} key={i}>
              {p.text}
            </div>
          ))}

          {brand && status === "manifested" && (
            <div className="msg phantom">
              <span className="who">Phantom</span>
              <p className="voice-line">{brand.essence}</p>
              {brand.story?.note && <p className="plain">{brand.story.note}</p>}
            </div>
          )}

          {/* conversational refinement turns */}
          {turns.map((t, i) => (
            <Fragment key={i}>
              <div className="msg user">
                <span className="who">You</span>
                <div className="bubble">
                  <p>{t.you}</p>
                </div>
              </div>
              {t.reply && (
                <div className="msg phantom">
                  <span className="who">Phantom</span>
                  <ReplyMd>{t.reply}</ReplyMd>
                </div>
              )}
            </Fragment>
          ))}

          {pending && (
            <>
              <div className="msg user">
                <span className="who">You</span>
                <div className="bubble">
                  <p>{pending.you}</p>
                </div>
              </div>
              {pending.logs.length > 0 && (
                <div className="lab-log" role="log" aria-label="Refinement log">
                  {pending.logs.map((l, i) => (
                    <div className="log-row" key={i}>
                      <span className={`verb ${l.verb.toLowerCase()}`}>{l.verb}</span>
                      <span className="target">{l.target}</span>
                      <Sig />
                    </div>
                  ))}
                </div>
              )}
              {pending.reply ? (
                <div className="msg phantom">
                  <span className="who">Phantom</span>
                  <ReplyMd>{pending.reply}</ReplyMd>
                </div>
              ) : (
                <div className="extract-row">PHANTOM CONSIDERS…</div>
              )}
            </>
          )}

          {error && (
            <div className="extract-row" style={{ color: "#ff9a9a" }}>
              {error}
            </div>
          )}
        </div>

        {/* composer → offer + summon */}
        <div className="composer">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) upload(e.target.files);
              e.target.value = "";
            }}
          />
          {status === "manifested" && pendingCount > 0 && (
            <button className="reextract-bar" type="button" onClick={extract}>
              Draw {pendingCount} new offering{pendingCount > 1 ? "s" : ""} into the brand →
            </button>
          )}
          {status === "manifested" ? (
            <div className="field">
              <button
                className={`offer-plus${uploading ? " busy" : ""}`}
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={!!pending || uploading}
                title="Offer files"
                aria-label="Offer files"
              >
                {uploading ? <span className="mini-spin" aria-hidden="true" /> : "+"}
              </button>
              <textarea
                className="refine-input"
                rows={1}
                aria-label="Answer the Phantom"
                placeholder={pending ? "Phantom considers…" : "Answer, or ask for a change…  (⇧↵ newline)"}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    startRefine(draft);
                  }
                }}
                disabled={!!pending}
              />
            </div>
          ) : (
            <div className="field">
              <button
                className={`offer-plus${uploading ? " busy" : ""}`}
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={status === "extracting" || uploading}
                title="Offer files"
                aria-label="Offer files"
              >
                {uploading ? <span className="mini-spin" aria-hidden="true" /> : "+"}
              </button>
              <button
                className="ghost-btn ecto send"
                type="button"
                onClick={extract}
                disabled={!offerings.length || status === "extracting"}
              >
                {status === "extracting" ? "Parting the veil…" : "Begin Extraction →"}
              </button>
            </div>
          )}
          <div className="hint">
            <span>
              {uploading
                ? "receiving the offering…"
                : status === "manifested"
                  ? "↵ to speak · + to offer more · the brand updates live"
                  : "drop offerings anywhere · the Phantom reads them"}
            </span>
            <span>it holds everything</span>
          </div>
        </div>

        <div className="drop-veil" aria-hidden="true">
          <p>Release the offering.</p>
        </div>
      </aside>

      {/* bottom: phases */}
      <footer className="phases" aria-label="Phases of the invocation">
        <div className={`phase ${status !== "idle" ? "done" : ""}`}>
          <span className="ring" />
          Offering
        </div>
        <span className={`phase-link${status !== "idle" ? " lit" : ""}`} />
        <div
          className={`phase ${status === "extracting" ? "now" : status === "manifested" ? "done" : ""}`}
          aria-current={status === "extracting" ? "step" : undefined}
        >
          <span className="ring" />
          Extraction
        </div>
        <span className={`phase-link${status === "manifested" ? " lit" : ""}`} />
        <div className={`phase ${status === "manifested" ? "now" : ""}`}>
          <span className="ring" />
          Threshold
        </div>
        <span className="spacer" />
        <Link
          className="ghost-btn cyan enter-manifest"
          href={`/manifest/${project.id}`}
          aria-disabled={status !== "manifested"}
          style={status !== "manifested" ? { opacity: 0.4, pointerEvents: "none" } : undefined}
        >
          Enter the Manifest <span className="arrow">→</span>
        </Link>
      </footer>
    </main>
  );
}
