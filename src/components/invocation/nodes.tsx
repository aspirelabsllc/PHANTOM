import { assetTypeOf, ASSET_TYPES, type AssetType, type Brand, type Offering } from "@/lib/brand";

type Pos = { nx: string; ny: string; pop: "pop-right" | "pop-left" | "pop-up"; d: number };

const POS: Record<string, Pos> = {
  Story: { nx: "17%", ny: "20%", pop: "pop-right", d: 5 },
  Color: { nx: "12%", ny: "42%", pop: "pop-right", d: 6 },
  Type: { nx: "15%", ny: "66%", pop: "pop-right", d: 7 },
  Voice: { nx: "31%", ny: "84%", pop: "pop-up", d: 8 },
  Logo: { nx: "79%", ny: "22%", pop: "pop-left", d: 9 },
  Usage: { nx: "85%", ny: "45%", pop: "pop-left", d: 10 },
  Assets: { nx: "82%", ny: "68%", pop: "pop-left", d: 11 },
  Compliance: { nx: "63%", ny: "86%", pop: "pop-up", d: 12 },
};

type Update = (fn: (b: Brand) => void) => void;

// --- tiny inline-edit primitives ---
function EInput({
  value,
  onChange,
  mono,
  className,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  className?: string;
  placeholder?: string;
}) {
  return (
    <input
      className={`pop-in${mono ? " mono" : ""}${className ? " " + className : ""}`}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
function EArea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      className="pop-in"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pop-field">
      <label>{label}</label>
      {children}
    </div>
  );
}
function Del({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="pop-del" onClick={onClick} aria-label="remove">
      ×
    </button>
  );
}
function Add({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="pop-add" onClick={onClick}>
      + {label}
    </button>
  );
}

function Node({
  label,
  lit,
  editing,
  count,
  children,
}: {
  label: string;
  lit: boolean;
  editing: boolean;
  count?: number;
  children: React.ReactNode;
}) {
  const p = POS[label];
  return (
    <div
      className={`node manifest${lit ? "" : " pending"}${editing ? " editing" : ""}`}
      style={{ ["--d" as string]: p.d, ["--nx" as string]: p.nx, ["--ny" as string]: p.ny }}
      tabIndex={0}
      aria-label={label}
    >
      <span className="node-mote" aria-hidden="true" />
      <span className="node-label">{label}</span>
      {count != null && <span className="node-count">{count}</span>}
      {(lit || editing) && (
        <div className={`node-pop ${p.pop}`} role="tooltip">
          {children}
        </div>
      )}
    </div>
  );
}

// The eight category nodes, drawn from a Brand. In editing mode, popover values
// become inputs that mutate the brand via `update`.
export function CategoryNodes({
  brand,
  lit,
  offerings,
  editing = false,
  update,
  onClassify,
}: {
  brand: Brand | null;
  lit: Set<string>;
  offerings: Offering[];
  editing?: boolean;
  update?: Update;
  onClassify?: (path: string, assetType: AssetType) => void;
}) {
  const b = brand;
  const has = (k: string) => lit.has(k);
  const up: Update = update ?? (() => {});
  const canEdit = editing && !!b;
  const cycleType = (path: string, current: AssetType) => {
    const next = ASSET_TYPES[(ASSET_TYPES.indexOf(current) + 1) % ASSET_TYPES.length];
    onClassify?.(path, next);
  };

  return (
    <>
      {/* STORY (+ identity) */}
      <Node label="Story" lit={has("Story")} editing={editing}>
        {canEdit ? (
          <>
            <div className="pop-head">IDENTITY · brand/story.md</div>
            <Field label="Name">
              <EInput value={b!.name} onChange={(v) => up((x) => (x.name = v))} />
            </Field>
            <Field label="Essence (the voice)">
              <EArea value={b!.essence} onChange={(v) => up((x) => (x.essence = v))} />
            </Field>
            <Field label="Story — one line">
              <EInput value={b!.story.essence} onChange={(v) => up((x) => (x.story.essence = v))} />
            </Field>
            <Field label="Story — note">
              <EArea value={b!.story.note} onChange={(v) => up((x) => (x.story.note = v))} />
            </Field>
          </>
        ) : (
          <>
            <div className="pop-head">STORY · brand/story.md</div>
            <p className="pop-essence">{b?.story?.essence}</p>
            {b?.story?.note && <p className="pop-note">{b.story.note}</p>}
          </>
        )}
      </Node>

      {/* COLOR */}
      <Node label="Color" lit={has("Color")} editing={editing} count={b?.color?.tokens?.length}>
        <div className="pop-head">
          COLOR · {b?.color?.tokens?.length ?? 0} TOKENS · brand/tokens.json
        </div>
        {canEdit ? (
          <>
            {b!.color.tokens.map((t, i) => (
              <div className="pop-erow" key={i}>
                <span className="sw" style={{ background: t.hex }} />
                <EInput
                  className="hex"
                  mono
                  value={t.hex}
                  onChange={(v) => up((x) => (x.color.tokens[i].hex = v))}
                />
                <EInput
                  mono
                  value={t.role}
                  onChange={(v) => up((x) => (x.color.tokens[i].role = v))}
                />
                <Del onClick={() => up((x) => x.color.tokens.splice(i, 1))} />
              </div>
            ))}
            <Add
              label="token"
              onClick={() => up((x) => x.color.tokens.push({ hex: "#888888", role: "new" }))}
            />
          </>
        ) : (
          <>
            <div className="pop-swatches" aria-hidden="true">
              {(b?.color?.tokens ?? []).slice(0, 8).map((t, i) => (
                <i key={i} style={{ background: t.hex }} />
              ))}
            </div>
            <div className="pop-hexes">
              {(b?.color?.tokens ?? []).slice(0, 4).map((t, i) => (
                <span key={i}>
                  <b>{t.hex}</b>&nbsp;{t.role}
                </span>
              ))}
            </div>
            {!!b?.color?.ratio?.length && (
              <>
                <div className="pop-ratio" aria-hidden="true">
                  {b.color.ratio.map((r, i) => (
                    <i key={i} style={{ width: `${r.pct}%`, background: r.hex }} />
                  ))}
                </div>
                <div className="pop-ratio-legend">
                  {b.color.ratio.map((r) => `${r.label} ${r.pct}`).join(" · ")}
                </div>
              </>
            )}
          </>
        )}
      </Node>

      {/* TYPE */}
      <Node label="Type" lit={has("Type")} editing={editing}>
        <div className="pop-head">TYPE · brand/type.json</div>
        {canEdit ? (
          <>
            <Field label="Display face">
              <EInput value={b!.type.display.name} onChange={(v) => up((x) => (x.type.display.name = v))} />
            </Field>
            <Field label="Display tag">
              <EInput value={b!.type.display.tag} onChange={(v) => up((x) => (x.type.display.tag = v))} />
            </Field>
            <Field label="Body face">
              <EInput value={b!.type.body.name} onChange={(v) => up((x) => (x.type.body.name = v))} />
            </Field>
            <Field label="Body note">
              <EInput value={b!.type.body.note} onChange={(v) => up((x) => (x.type.body.note = v))} />
            </Field>
          </>
        ) : (
          <>
            <div className="pop-face-display">{b?.type?.display?.name}</div>
            <span className="pop-face-tag">DISPLAY</span>
            {b?.type?.body?.note && <p className="pop-face-body">{b.type.body.note}</p>}
            <span className="pop-face-tag">BODY · {b?.type?.body?.name}</span>
            {b?.type?.display?.tag && <span className="pop-chip">{b.type.display.tag}</span>}
          </>
        )}
      </Node>

      {/* VOICE */}
      <Node label="Voice" lit={has("Voice")} editing={editing}>
        <div className="pop-head">VOICE · brand/voice.md</div>
        {canEdit ? (
          <>
            <Field label="Essence">
              <EInput value={b!.voice.essence} onChange={(v) => up((x) => (x.voice.essence = v))} />
            </Field>
            {b!.voice.prohibitions.map((r, i) => (
              <div className="pop-erow" key={i}>
                <button
                  type="button"
                  className="pop-rt-toggle"
                  style={{ color: r.level === "HARD" ? "#E79B98" : "var(--violet)" }}
                  onClick={() =>
                    up((x) => (x.voice.prohibitions[i].level = r.level === "HARD" ? "NEVER" : "HARD"))
                  }
                >
                  {r.level}
                </button>
                <EInput value={r.text} onChange={(v) => up((x) => (x.voice.prohibitions[i].text = v))} />
                <Del onClick={() => up((x) => x.voice.prohibitions.splice(i, 1))} />
              </div>
            ))}
            <Add
              label="prohibition"
              onClick={() => up((x) => x.voice.prohibitions.push({ level: "NEVER", text: "" }))}
            />
          </>
        ) : (
          <>
            <p className="pop-essence">{b?.voice?.essence}</p>
            {!!b?.voice?.prohibitions?.length && (
              <div style={{ marginTop: 10 }}>
                {b.voice.prohibitions.slice(0, 3).map((r, i) => (
                  <div className="pop-rule" key={i}>
                    <span className={`rt ${r.level === "HARD" ? "hard" : "never"}`}>{r.level}</span>
                    <span>{r.text}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Node>

      {/* LOGO */}
      <Node label="Logo" lit={has("Logo")} editing={editing}>
        <div className="pop-head">LOGO · brand/logo.md</div>
        {canEdit ? (
          <>
            {b!.logo.facts.map((f, i) => (
              <div className="pop-erow" key={i}>
                <EInput
                  className="hex"
                  value={f.label}
                  onChange={(v) => up((x) => (x.logo.facts[i].label = v))}
                />
                <EInput value={f.value} onChange={(v) => up((x) => (x.logo.facts[i].value = v))} />
                <Del onClick={() => up((x) => x.logo.facts.splice(i, 1))} />
              </div>
            ))}
            <Add label="rule" onClick={() => up((x) => x.logo.facts.push({ label: "RULE", value: "" }))} />
          </>
        ) : (
          (b?.logo?.facts ?? []).slice(0, 4).map((f, i) => (
            <div className="pop-fact" key={i}>
              <span>{f.label}</span>
              <b>{f.value}</b>
            </div>
          ))
        )}
      </Node>

      {/* USAGE */}
      <Node label="Usage" lit={has("Usage")} editing={editing}>
        <div className="pop-head">USAGE · brand/usage.md</div>
        {canEdit ? (
          <>
            {b!.usage.rules.map((r, i) => (
              <div className="pop-erow" key={i}>
                <button
                  type="button"
                  className="pop-rt-toggle"
                  style={{ color: r.kind === "DO" ? "var(--cyan)" : "var(--violet)" }}
                  onClick={() => up((x) => (x.usage.rules[i].kind = r.kind === "DO" ? "DONT" : "DO"))}
                >
                  {r.kind}
                </button>
                <EInput value={r.text} onChange={(v) => up((x) => (x.usage.rules[i].text = v))} />
                <Del onClick={() => up((x) => x.usage.rules.splice(i, 1))} />
              </div>
            ))}
            <Add label="rule" onClick={() => up((x) => x.usage.rules.push({ kind: "DO", text: "" }))} />
          </>
        ) : (
          (b?.usage?.rules ?? []).slice(0, 4).map((r, i) => (
            <div className="pop-rule" key={i}>
              <span className={`rt ${r.kind === "DO" ? "do" : "never"}`}>{r.kind}</span>
              <span>{r.text}</span>
            </div>
          ))
        )}
      </Node>

      {/* ASSETS — classified for the Manifest handoff */}
      <Node label="Assets" lit={has("Assets")} editing={editing} count={offerings.length}>
        <div className="pop-head">ASSETS · {offerings.length} FILES · brand/assets/</div>
        {offerings.length === 0 ? (
          <div className="pop-files">
            <span className="more">no assets held yet</span>
          </div>
        ) : (
          <div className="pop-assets">
            {offerings.map((o, i) => {
              const t = assetTypeOf(o);
              return (
                <div className="pop-asset" key={o.path || i}>
                  <span className="pa-name">{o.name}</span>
                  {editing ? (
                    <button
                      type="button"
                      className={`pa-tag t-${t}`}
                      onClick={() => cycleType(o.path, t)}
                      title="click to reclassify"
                    >
                      {t}
                    </button>
                  ) : (
                    <span className={`pa-tag t-${t}`}>{t}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Node>

      {/* COMPLIANCE */}
      <Node
        label="Compliance"
        lit={has("Compliance")}
        editing={editing}
        count={b?.compliance?.rules?.length || undefined}
      >
        <div className="pop-head">
          COMPLIANCE · {b?.compliance?.rules?.length ?? 0} RULES · brand/compliance.json
        </div>
        {canEdit ? (
          <>
            <Field label="Posture">
              <EInput value={b!.compliance.note} onChange={(v) => up((x) => (x.compliance.note = v))} />
            </Field>
            {b!.compliance.rules.map((r, i) => (
              <div className="pop-erow" key={i}>
                <span className="pop-rt-toggle" style={{ color: "#E79B98" }}>
                  HARD
                </span>
                <EInput value={r.text} onChange={(v) => up((x) => (x.compliance.rules[i].text = v))} />
                <Del onClick={() => up((x) => x.compliance.rules.splice(i, 1))} />
              </div>
            ))}
            <Add
              label="hard rule"
              onClick={() => up((x) => x.compliance.rules.push({ level: "HARD", text: "" }))}
            />
          </>
        ) : (
          <>
            {b?.compliance?.note && (
              <p className="pop-note" style={{ marginTop: 0 }}>
                {b.compliance.note}
              </p>
            )}
            {!!b?.compliance?.rules?.length && (
              <div style={{ marginTop: 9 }}>
                {b.compliance.rules.slice(0, 3).map((r, i) => (
                  <div className="pop-rule" key={i}>
                    <span className="rt hard">HARD</span>
                    <span>{r.text}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Node>
    </>
  );
}
