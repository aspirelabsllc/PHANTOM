"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { frameDomain, assetTypeOf, type Project } from "@/lib/brand";
import type { StoredMessage } from "@/lib/projects";
import { ReplyMd } from "@/components/reply-md";

type Row = { verb?: string; target?: string };
type Turn = { you: string; reply: string; logs: Row[] };

// Rebuild the committed conversation from persisted rows. Each user row opens a
// turn; the following phantom row fills its reply/logs (or an error line).
function messagesToTurns(msgs: StoredMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (const m of msgs) {
    if (m.role === "user") {
      turns.push({ you: m.content.text ?? "", reply: "", logs: [] });
    } else if (turns.length) {
      const cur = turns[turns.length - 1];
      if (m.kind === "error") cur.reply = `The build faltered — ${m.content.message ?? ""}`;
      else {
        cur.reply = m.content.reply ?? "";
        cur.logs = m.content.logs ?? [];
      }
    }
  }
  return turns;
}

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
  const assets = project.offerings ?? [];

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
      if (scope === "full") setPreviewKey((k) => k + 1);
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
    setPending({ you: say, reply: "", logs: [] });

    const es = new EventSource(`/api/projects/${project.id}/build?say=${encodeURIComponent(say)}`);
    es.onmessage = (e) => {
      const m = JSON.parse(e.data);
      switch (m.t) {
        case "log":
          setPending((p) => (p ? { ...p, logs: [...p.logs, { verb: m.verb, target: m.target }] } : p));
          break;
        case "say":
          setPending((p) => (p ? { ...p, reply: (p.reply ? p.reply + " " : "") + m.text } : p));
          break;
        case "done":
          setPending((p) => {
            if (p) setTurns((t) => [...t, p]);
            return null;
          });
          setBuilding(false);
          setPreviewKey((k) => k + 1);
          es.close();
          break;
        case "error":
          setPending((p) => {
            if (p) setTurns((t) => [...t, { ...p, reply: p.reply || `The build faltered — ${m.message}` }]);
            return null;
          });
          setBuilding(false);
          es.close();
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
        <button
          className="ghost-btn"
          onClick={() => doReset("full")}
          disabled={resetting || building || !preview}
          title="Reset the site and conversation to a fresh start"
        >
          {resetting ? "Resetting…" : "Reset"}
        </button>
        <button
          className="ghost-btn"
          onClick={() => preview && window.open(preview, "_blank", "noopener")}
          disabled={!preview}
          title="Open the live preview in a new tab"
        >
          Take&nbsp;a&nbsp;Peek
        </button>
        <button className="ghost-btn ecto crossover" title="Publish — coming soon" disabled>
          <span className="dot ecto" />
          Publish
        </button>
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
        <div className="chat-scroll">
          <div className="msg phantom">
            <span className="who">Phantom</span>
            <p className="voice-line">
              The vault holds {name}. Speak — name what this site should be, and I will draw it from
              the brand.
            </p>
            <p className="plain">
              I read the colors, faces, voice, and hard rules you drew, then write a real site that
              never crosses them. Try: <b>“build a landing page for {name}.”</b>
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
              {!!t.logs.length && (
                <div className="lab-log" role="log">
                  {t.logs.map((l, j) => (
                    <div className="log-row" key={j}>
                      <span className={`verb ${(l.verb ?? "").toLowerCase()}`}>{l.verb}</span>
                      <span className="target">{l.target}</span>
                    </div>
                  ))}
                </div>
              )}
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
              {!!pending.logs.length && (
                <div className="lab-log" role="log">
                  {pending.logs.map((l, j) => (
                    <div className={`log-row${j === pending.logs.length - 1 ? " running" : ""}`} key={j}>
                      <span className={`verb ${(l.verb ?? "").toLowerCase()}`}>{l.verb}</span>
                      <span className="target">{l.target}</span>
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
                !pending.logs.length && <div className="sys-row">THE PHANTOM IS AT WORK…</div>
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
                  ? "Speak, and it will take shape…  (⇧↵ newline)"
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
        <div className="chamber-stage">
          <div className="chamber-frame" style={{ ["--frame-w" as string]: FRAME_W[device] }}>
            {preview ? (
              <iframe key={previewKey} src={preview} title={`${name} — live preview`} />
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

                {/* LOGO & ASSETS */}
                <section className="v-sec">
                  <div className="v-sec-head">
                    <span>Logo&nbsp;&amp;&nbsp;Assets</span>
                    <span className="path">brand/assets/</span>
                    <span className="count">{assets.length}</span>
                  </div>
                  <div className="asset-grid">
                    {assets.slice(0, 5).map((o, i) => (
                      <div className="asset-tile" key={o.path || i} tabIndex={0} aria-label={o.name}>
                        <span className="a-kind">{o.kind}</span>
                        <span className="a-name">{assetTypeOf(o)}</span>
                      </div>
                    ))}
                    <Link className="asset-tile offer" href={`/invocation/${project.id}`}>
                      <span className="plus" aria-hidden="true">
                        +
                      </span>
                      <span className="lbl">
                        OFFER
                        <br />
                        NEW
                      </span>
                    </Link>
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
