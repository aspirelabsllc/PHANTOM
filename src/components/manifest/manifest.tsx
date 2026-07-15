"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  frameDomain,
  assetTypeOf,
  VARIANTS,
  VARIANT_META,
  type Project,
  type Variant,
} from "@/lib/brand";
import type { StoredMessage } from "@/lib/projects";
import { ReplyMd } from "@/components/reply-md";

type Row = { verb?: string; target?: string };
// One apparition's share of a turn. Keyed by variant; "" = legacy single-lane rows.
type Lane = { reply: string; logs: Row[] };
type Turn = { you: string; lanes: Record<string, Lane> };

const LANE_ORDER: string[] = ["", ...VARIANTS];

// Rebuild the committed conversation from persisted rows. Each user row opens a
// turn; following phantom rows fill their variant's lane (or an error line).
function messagesToTurns(msgs: StoredMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (const m of msgs) {
    if (m.role === "user") {
      turns.push({ you: m.content.text ?? "", lanes: {} });
    } else if (turns.length) {
      const cur = turns[turns.length - 1];
      const v = m.content.variant ?? "";
      cur.lanes[v] =
        m.kind === "error"
          ? { reply: `The build faltered — ${m.content.message ?? ""}`, logs: [] }
          : { reply: m.content.reply ?? "", logs: m.content.logs ?? [] };
    }
  }
  return turns;
}

// Point the signed preview URL at one apparition's directory.
function variantUrl(base: string, v: Variant): string {
  try {
    const u = new URL(base);
    u.pathname = `/designs/${v}/`;
    return u.toString();
  } catch {
    return base;
  }
}

// An asset row as the panel consumes it (from GET /assets).
type PanelAsset = {
  name: string;
  path?: string;
  url: string | null;
  assetType: string;
  kind: string;
  origin?: string;
  note?: string;
};

type Device = "desktop" | "tablet" | "phone";
type Tab = "layers" | "inspect" | "vault";

const FRAME_W: Record<Device, string> = { desktop: "100%", tablet: "620px", phone: "384px" };

const SIGIL = (
  <svg width="40" height="40" viewBox="0 0 22 22" fill="none" aria-hidden="true">
    <path
      d="M4.5 17.5h4.2c-2.4-1.3-4-3.6-4-6.5a6.3 6.3 0 1 1 12.6 0c0 2.9-1.6 5.2-4 6.5h4.2"
      stroke="#7FF7E4"
      strokeOpacity="0.8"
      strokeWidth="1.1"
      strokeLinecap="round"
    />
  </svg>
);

function DeviceDot({ d }: { d: Device }) {
  if (d === "desktop")
    return (
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <circle cx="6" cy="6" r="5" stroke="currentColor" />
        <circle cx="6" cy="6" r="5" fill="currentColor" />
      </svg>
    );
  if (d === "tablet")
    return (
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <circle cx="6" cy="6" r="5" stroke="currentColor" />
        <path d="M6 1a5 5 0 0 1 0 10Z" fill="currentColor" />
      </svg>
    );
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="5" stroke="currentColor" />
    </svg>
  );
}

export function Manifest({
  project,
  initialMessages = [],
}: {
  project: Project;
  initialMessages?: StoredMessage[];
}) {
  const [device, setDevice] = useState<Device>("desktop");
  const [tab, setTab] = useState<Tab>("vault");
  const [vaultOpen, setVaultOpen] = useState(true);
  const b = project.brand;
  const name = b?.name ?? project.name;
  const domain = frameDomain(project);

  // the three apparitions
  const [variant, setVariant] = useState<Variant>(project.chosen_variant ?? "one");
  const [chosen, setChosen] = useState<Variant | null>(project.chosen_variant ?? null);
  const [claiming, setClaiming] = useState(false);

  async function claim(v: Variant) {
    if (claiming) return;
    setClaiming(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/choose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ variant: v }),
      });
      if (res.ok) setChosen(v);
    } finally {
      setClaiming(false);
    }
  }

  // the vault's assets (thumbnails + signed URLs); refreshed after builds,
  // uploads, and removals so conjured imagery appears as it lands
  const [vaultAssets, setVaultAssets] = useState<PanelAsset[] | null>(null);
  const [assetBusy, setAssetBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const loadAssets = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/assets`);
      const data = await res.json();
      if (res.ok) setVaultAssets(data.assets as PanelAsset[]);
    } catch {
      // panel keeps its last known state
    }
  }, [project.id]);
  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  async function uploadAssets(files: FileList | null) {
    if (!files?.length || assetBusy) return;
    setAssetBusy(true);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append("files", f);
      await fetch(`/api/projects/${project.id}/assets`, { method: "POST", body: fd });
      await loadAssets();
    } finally {
      setAssetBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function deleteAsset(a: PanelAsset) {
    if (!a.path || assetBusy) return;
    if (!window.confirm(`Remove ${a.name} from the vault? The site will stop shipping it.`)) return;
    setAssetBusy(true);
    try {
      await fetch(`/api/projects/${project.id}/assets?path=${encodeURIComponent(a.path)}`, {
        method: "DELETE",
      });
      await loadAssets();
    } finally {
      setAssetBusy(false);
    }
  }

  const assets: PanelAsset[] =
    vaultAssets ??
    (project.offerings ?? []).map((o) => ({
      name: o.name,
      path: o.path,
      url: null,
      assetType: assetTypeOf(o),
      kind: o.kind,
      origin: o.origin,
      note: o.note,
    }));

  // the sandbox chamber
  const [preview, setPreview] = useState<string | null>(null);
  const [booting, setBooting] = useState(false);
  const [bootErr, setBootErr] = useState<string | null>(null);

  async function boot() {
    setBooting(true);
    setBootErr(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/sandbox`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "boot failed");
      setPreview(data.previewUrl as string);
    } catch (e) {
      setBootErr(e instanceof Error ? e.message : "The chamber would not open.");
    } finally {
      setBooting(false);
    }
  }

  useEffect(() => {
    if (b) boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // build conversation
  const [draft, setDraft] = useState("");
  const [building, setBuilding] = useState(false);
  const [turns, setTurns] = useState<Turn[]>(() => messagesToTurns(initialMessages));
  const [pending, setPending] = useState<Turn | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [resetting, setResetting] = useState(false);

  // keep the chat pinned to the latest message as it streams
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, pending]);

  // Reset a project. "conversation" clears the chat + agent memory; "full" also
  // wipes the site back to the starter scaffold and reloads the preview.
  async function doReset(scope: "conversation" | "full") {
    if (resetting || building) return;
    const msg =
      scope === "full"
        ? "Reset the entire site to a fresh start and clear the conversation? This cannot be undone."
        : "Reset the conversation and the Phantom's memory? The built site is kept.";
    if (!window.confirm(msg)) return;
    setResetting(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/reset?scope=${scope}`, { method: "POST" });
      if (!res.ok) throw new Error("reset failed");
      setTurns([]);
      setPending(null);
      if (scope === "full") {
        // the summons re-opens: no form is claimed anymore
        setChosen(null);
        setVariant("one");
        setPreviewKey((k) => k + 1);
      }
    } catch {
      // leave state as-is on failure
    } finally {
      setResetting(false);
    }
  }

  function startBuild(text: string) {
    const say = text.trim();
    if (!say || building || !preview) return;
    setDraft("");
    setBuilding(true);
    setPending({ you: say, lanes: {} });

    const lane = (p: Turn, v: string): Lane => p.lanes[v] ?? { reply: "", logs: [] };
    const withLane = (p: Turn, v: string, l: Lane): Turn => ({ ...p, lanes: { ...p.lanes, [v]: l } });

    const es = new EventSource(`/api/projects/${project.id}/build?say=${encodeURIComponent(say)}`);
    es.onmessage = (e) => {
      const m = JSON.parse(e.data);
      const v: string = m.v ?? "";
      switch (m.t) {
        case "log":
          setPending((p) => {
            if (!p) return p;
            const l = lane(p, v);
            return withLane(p, v, { ...l, logs: [...l.logs, { verb: m.verb, target: m.target }] });
          });
          break;
        case "say":
          setPending((p) => {
            if (!p) return p;
            const l = lane(p, v);
            return withLane(p, v, { ...l, reply: (l.reply ? l.reply + " " : "") + m.text });
          });
          break;
        case "variant-done":
          // this apparition finished — show its fresh form at once
          setPreviewKey((k) => k + 1);
          loadAssets();
          break;
        case "done":
          setPending((p) => {
            if (p) setTurns((t) => [...t, p]);
            return null;
          });
          setBuilding(false);
          setPreviewKey((k) => k + 1);
          loadAssets();
          es.close();
          break;
        case "error":
          if (v) {
            // one apparition faltered; the others build on
            setPending((p) => {
              if (!p) return p;
              const l = lane(p, v);
              return withLane(p, v, { ...l, reply: l.reply || `The build faltered — ${m.message}` });
            });
          } else {
            setPending((p) => {
              if (p) setTurns((t) => [...t, p]);
              return null;
            });
            setBuilding(false);
            es.close();
          }
          break;
      }
    };
    es.onerror = () => {
      es.close();
      setBuilding(false);
      setPending((p) => {
        if (p) setTurns((t) => [...t, p]);
        return null;
      });
    };
  }

  return (
    <div className={`manifest-shell${vaultOpen ? "" : " vault-collapsed"}`}>
      {/* top bar */}
      <header className="s-top">
        <Link className="back" href="/gallery">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M7.5 2 3.5 6l4 4"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Gallery
        </Link>
        <span className="divider" aria-hidden="true" />
        <h1 className="proj">
          {name} <em>the manifest</em>
        </h1>
        <div className="status">
          <span className="dot cyan breathe" />
          {booting
            ? "SUMMONING THE CHAMBER"
            : preview
              ? "LIVE · NOT YET CROSSED"
              : b
                ? "ATTUNED · NOT YET CROSSED"
                : "AWAITING THE FORM"}
        </div>
        <div className="spacer" />
        <div className="top-actions">
          <button
            className="top-action danger"
            onClick={() => doReset("full")}
            disabled={resetting || building || !preview}
            title="Reset the site and conversation to a fresh start"
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M11.6 4.2A5 5 0 1 0 12 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              <path d="M12 1.7v2.6H9.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {resetting ? "Resetting…" : "Reset"}
          </button>
          <button
            className="top-action peek"
            onClick={() => preview && window.open(preview, "_blank", "noopener")}
            disabled={!preview}
            title="Open the live preview in a new tab"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M1 8s2.6-4.4 7-4.4S15 8 15 8s-2.6 4.4-7 4.4S1 8 1 8Z" stroke="currentColor" strokeWidth="1.1" />
              <circle cx="8" cy="8" r="1.9" stroke="currentColor" strokeWidth="1.1" />
            </svg>
            Take&nbsp;a&nbsp;Peek
          </button>
          <button className="ghost-btn ecto crossover" title="Publish — coming soon" disabled>
            <span className="dot ecto" />
            Publish
          </button>
        </div>
      </header>

      {/* left: chat */}
      <aside className="m-chat" aria-label="Conversation with the Phantom">
        <div className="chat-head">
          <span className="mono">
            PHANTOM&nbsp;·&nbsp;
            <span className="lit">{building ? "BUILDING" : b ? "ATTUNED" : "DORMANT"}</span>
          </span>
          <button
            className="chat-reset"
            onClick={() => doReset("conversation")}
            disabled={resetting || building}
            title="Reset the conversation and the Phantom's memory"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M9.5 3.2A4 4 0 1 0 10 6"
                stroke="currentColor"
                strokeWidth="1.1"
                strokeLinecap="round"
              />
              <path d="M9.8 1.6v2h-2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            RESET&nbsp;CHAT
          </button>
        </div>
        <div className="chat-scroll" ref={scrollRef}>
          <div className="msg phantom">
            <span className="who">Phantom</span>
            <p className="voice-line">
              The vault holds {name}. Speak — and three apparitions will each take a different
              shape: two faithful to the brand, one unbound.
            </p>
            <p className="plain">
              Compare them in the chamber, claim the one that speaks to you, then refine it here.
              Try: <b>“build a landing page for {name}.”</b>
            </p>
          </div>

          {turns.map((t, i) => (
            <Fragment key={i}>
              <div className="msg user">
                <span className="who">You</span>
                <div className="bubble">
                  <p>{t.you}</p>
                </div>
              </div>
              {LANE_ORDER.filter((v) => t.lanes[v]).map((v) => {
                const l = t.lanes[v];
                return (
                  <Fragment key={v}>
                    {v && (
                      <div className="lane-cap">
                        APPARITION&nbsp;{VARIANT_META[v as Variant].numeral}&nbsp;·&nbsp;
                        {VARIANT_META[v as Variant].label}
                      </div>
                    )}
                    {!!l.logs.length && (
                      <div className="lab-log" role="log">
                        {l.logs.map((r, j) => (
                          <div className="log-row" key={j}>
                            <span className={`verb ${(r.verb ?? "").toLowerCase()}`}>{r.verb}</span>
                            <span className="target">{r.target}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {l.reply && (
                      <div className="msg phantom">
                        <span className="who">Phantom</span>
                        <ReplyMd>{l.reply}</ReplyMd>
                      </div>
                    )}
                  </Fragment>
                );
              })}
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
              {LANE_ORDER.filter((v) => pending.lanes[v]).map((v) => {
                const l = pending.lanes[v];
                return (
                  <Fragment key={v}>
                    {v && (
                      <div className="lane-cap">
                        APPARITION&nbsp;{VARIANT_META[v as Variant].numeral}&nbsp;·&nbsp;
                        {VARIANT_META[v as Variant].label}
                      </div>
                    )}
                    {!!l.logs.length && (
                      <div className="lab-log" role="log">
                        {l.logs.map((r, j) => (
                          <div className={`log-row${j === l.logs.length - 1 && !l.reply ? " running" : ""}`} key={j}>
                            <span className={`verb ${(r.verb ?? "").toLowerCase()}`}>{r.verb}</span>
                            <span className="target">{r.target}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {l.reply && (
                      <div className="msg phantom">
                        <span className="who">Phantom</span>
                        <ReplyMd>{l.reply}</ReplyMd>
                      </div>
                    )}
                  </Fragment>
                );
              })}
              {!Object.keys(pending.lanes).length && (
                <div className="sys-row">
                  {chosen ? "THE PHANTOM IS AT WORK…" : "THREE APPARITIONS ARE AT WORK…"}
                </div>
              )}
            </>
          )}
        </div>
        <div className="m-composer">
          <div className="field">
            <textarea
              className="refine-input"
              rows={1}
              aria-label="Speak to the Phantom"
              placeholder={
                preview
                  ? chosen
                    ? "Speak to the claimed form…  (⇧↵ newline)"
                    : "Speak — all three apparitions will heed…  (⇧↵ newline)"
                  : "Waiting for the chamber to open…"
              }
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  startBuild(draft);
                }
              }}
              disabled={!preview || building}
            />
          </div>
        </div>
      </aside>

      {/* center: chamber */}
      <section className="chamber" aria-label="Live preview — the apparition chamber">
        <div className="chamber-bar">
          <div className="url-readout">
            <span className="lock" aria-hidden="true">
              <svg width="10" height="11" viewBox="0 0 10 11" fill="none">
                <rect x="1" y="4.5" width="8" height="5.5" rx="1" stroke="currentColor" />
                <path d="M3 4.5V3a2 2 0 1 1 4 0v1.5" stroke="currentColor" />
              </svg>
            </span>
            <b>{domain}</b>
            <span className="tail">&nbsp;·&nbsp;NOT&nbsp;PUBLISHED&nbsp;YET</span>
          </div>
          <div className="spacer" />
          <div className="phase-toggles" role="group" aria-label="Device phase">
            {(["desktop", "tablet", "phone"] as Device[]).map((d) => (
              <button
                key={d}
                className={device === d ? "on" : ""}
                aria-pressed={device === d}
                onClick={() => setDevice(d)}
              >
                <DeviceDot d={d} />
                {d[0].toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
          <button
            className="vault-toggle"
            aria-expanded={vaultOpen}
            aria-label={vaultOpen ? "Collapse the Vault" : "Expand the Vault"}
            title={vaultOpen ? "Collapse the Vault" : "Expand the Vault"}
            onClick={() => setVaultOpen((o) => !o)}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true"
              style={{ transform: vaultOpen ? "none" : "rotate(180deg)" }}
            >
              <path
                d="M4.5 2 8.5 6l-4 4"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <div className="apparition-row">
          <div className="apparition-tabs" role="tablist" aria-label="The three apparitions">
            {VARIANTS.map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={variant === v}
                className={variant === v ? "on" : ""}
                onClick={() => setVariant(v)}
              >
                <b>{VARIANT_META[v].numeral}</b>
                <span>{VARIANT_META[v].label}</span>
                {chosen === v && (
                  <span className="ap-star" aria-label="the claimed form">
                    ✦
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="spacer" />
          {chosen === variant ? (
            <span className="claimed-note">✦&nbsp;THE&nbsp;CLAIMED&nbsp;FORM</span>
          ) : (
            <button
              className="claim-btn"
              onClick={() => claim(variant)}
              disabled={claiming || building || !preview}
              title="Make this apparition THE site — the conversation will address it alone"
            >
              {claiming ? "CLAIMING…" : chosen ? "CLAIM THIS INSTEAD" : "CLAIM THIS FORM"}
            </button>
          )}
        </div>
        <div className="chamber-stage">
          <div className="chamber-frame" style={{ ["--frame-w" as string]: FRAME_W[device] }}>
            {preview ? (
              <iframe
                key={`${previewKey}-${variant}`}
                src={variantUrl(preview, variant)}
                title={`${name} — apparition ${VARIANT_META[variant].numeral}`}
              />
            ) : booting ? (
              <div className="frame-await">
                <span className="await-sigil">{SIGIL}</span>
                <h2>Summoning the chamber…</h2>
                <p>
                  Booting the sandbox and installing the runtime — this can take a minute on first
                  open.
                </p>
              </div>
            ) : bootErr ? (
              <div className="frame-await">
                <span className="await-sigil">{SIGIL}</span>
                <h2>The chamber would not open.</h2>
                <p>{bootErr}</p>
                <button className="ghost-btn cyan" type="button" onClick={boot} style={{ marginTop: 6 }}>
                  Try again
                </button>
              </div>
            ) : (
              <div className="frame-await">
                <span className="await-sigil">{SIGIL}</span>
                <h2>The form has not yet condensed.</h2>
                <p>Draw this brand in the Invocation first, then return to manifest it.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* right: the vault */}
      <aside className="vault" aria-label="The Vault — the stored brand" aria-hidden={!vaultOpen}>
        <div className="vault-tabs" role="tablist">
          {(["layers", "inspect", "vault"] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={tab === t ? "on" : ""}
              onClick={() => setTab(t)}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div className="vault-scroll">
          {tab === "layers" && (
            <div className="vault-sleep">
              <p>The layers sleep until the form is built and you select something in the chamber.</p>
              <span className="mono">NOTHING TO INSPECT YET</span>
            </div>
          )}
          {tab === "inspect" && (
            <div className="vault-sleep">
              <p>Select an element in the chamber and the Phantom will read its properties aloud.</p>
              <span className="mono">NOTHING SELECTED</span>
            </div>
          )}
          {tab === "vault" &&
            (b ? (
              <div>
                {/* COLOR */}
                {!!b.color?.tokens?.length && (
                  <section className="v-sec">
                    <div className="v-sec-head">
                      <span>Color</span>
                      <span className="path">brand/tokens.json</span>
                      <span className="count">{b.color.tokens.length}</span>
                    </div>
                    {b.color.tokens.slice(0, 8).map((t, i) => (
                      <div className="tok-row" key={i}>
                        <span className="tok-chip" style={{ background: t.hex }} />
                        <span className="tok-name">{t.role}</span>
                        <span className="tok-hex">{t.hex}</span>
                      </div>
                    ))}
                    {!!b.color.ratio?.length && (
                      <div className="v-more">
                        RATIO&nbsp;·&nbsp;{b.color.ratio.map((r) => r.pct).join("/")}
                      </div>
                    )}
                  </section>
                )}

                {/* TYPE */}
                {b.type?.display?.name && (
                  <section className="v-sec">
                    <div className="v-sec-head">
                      <span>Type</span>
                      <span className="path">brand/type.json</span>
                      <span className="count">2</span>
                    </div>
                    <div className="face-row">
                      <span className="face-ag" aria-hidden="true">
                        Ag
                      </span>
                      <span className="face-meta">
                        <span className="face-name">{b.type.display.name}</span>
                        <span className="face-role">DISPLAY</span>
                      </span>
                    </div>
                    {b.type.body?.name && (
                      <div className="face-row">
                        <span
                          className="face-ag"
                          style={{ fontFamily: "var(--font-specimen-body), sans-serif", fontWeight: 400 }}
                          aria-hidden="true"
                        >
                          Ag
                        </span>
                        <span className="face-meta">
                          <span className="face-name">{b.type.body.name}</span>
                          <span className="face-role">BODY</span>
                        </span>
                      </div>
                    )}
                  </section>
                )}

                {/* VOICE */}
                {b.voice?.essence && (
                  <section className="v-sec">
                    <div className="v-sec-head">
                      <span>Voice</span>
                      <span className="path">brand/voice.md</span>
                    </div>
                    <p className="voice-essence">“{b.voice.essence}”</p>
                    {!!b.voice.prohibitions?.length && (
                      <div className="voice-meta">
                        <span className="never">
                          {b.voice.prohibitions.length}&nbsp;NEVER-SAY&nbsp;RULES
                        </span>
                      </div>
                    )}
                  </section>
                )}

                {/* LOGO & ASSETS — the two-way mirror of the VM's public/assets/ */}
                <section className="v-sec">
                  <div className="v-sec-head">
                    <span>Logo&nbsp;&amp;&nbsp;Assets</span>
                    <span className="path">public/assets/</span>
                    <span className="count">{assets.length}</span>
                  </div>
                  <div className="asset-grid">
                    {assets.map((a, i) => (
                      <div className="asset-tile" key={a.path || i} tabIndex={0} aria-label={a.name}>
                        {a.url && (a.assetType === "image" || a.assetType === "logo") ? (
                          // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL
                          <img src={a.url} alt={a.name} loading="lazy" />
                        ) : (
                          <span className="a-kind">{a.kind}</span>
                        )}
                        <span className="a-name" title={a.note || a.name}>
                          {a.name}
                        </span>
                        {a.origin === "conjured" && <span className="a-conjured">CONJURED</span>}
                        <button
                          className="a-del"
                          onClick={() => deleteAsset(a)}
                          disabled={assetBusy}
                          aria-label={`Remove ${a.name}`}
                          title="Remove from the vault and the site"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      className="asset-tile offer"
                      onClick={() => fileRef.current?.click()}
                      disabled={assetBusy}
                      type="button"
                    >
                      <span className="plus" aria-hidden="true">
                        +
                      </span>
                      <span className="lbl">
                        {assetBusy ? "WORKING…" : "ADD"}
                        <br />
                        {assetBusy ? "" : "ASSET"}
                      </span>
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      multiple
                      hidden
                      accept="image/*,.svg,.woff,.woff2,.ttf,.otf"
                      onChange={(e) => uploadAssets(e.target.files)}
                    />
                  </div>
                  {!!b.logo?.facts?.length && (
                    <div className="v-more">
                      {b.logo.facts.length}&nbsp;LOGO&nbsp;RULES&nbsp;HELD
                    </div>
                  )}
                </section>

                {/* COMPLIANCE */}
                {(b.compliance?.rules?.length || b.compliance?.note) && (
                  <section className="v-sec">
                    <div className="v-sec-head">
                      <span>Compliance</span>
                      <span className="path">brand/compliance.json</span>
                      {!!b.compliance.rules?.length && (
                        <span className="count">{b.compliance.rules.length}</span>
                      )}
                    </div>
                    {!!b.compliance.rules?.length && (
                      <div className="comp-row">
                        <span className="comp-dots" aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </span>
                        <span className="comp-count">
                          {b.compliance.rules.length}&nbsp;HARD&nbsp;RULES
                        </span>
                      </div>
                    )}
                    {b.compliance.rules?.[0] && (
                      <p className="comp-sample">
                        <span className="hard">HARD</span>
                        {b.compliance.rules[0].text}
                      </p>
                    )}
                  </section>
                )}
              </div>
            ) : (
              <div className="vault-sleep">
                <p>The vault is empty. Return to the Invocation and draw this brand first.</p>
                <span className="mono">NO BRAND HELD</span>
              </div>
            ))}
        </div>

        <div className="vault-foot">
          <Link className="ghost-btn" href={`/invocation/${project.id}`} style={{ padding: "8px 14px" }}>
            + EDIT VAULT
          </Link>
          <span className="vault-sync">
            <span className="dot ecto breathe" />
            IN&nbsp;SYNC
          </span>
        </div>
      </aside>
    </div>
  );
}
