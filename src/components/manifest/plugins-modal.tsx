"use client";

import { useEffect, useState } from "react";
import { DEFAULT_PLUGINS, isValidPluginName, isValidPluginRepo, type Plugin } from "@/lib/plugins";

// The plugin registry panel: toggle the built-ins, add or remove custom skill
// repos. Saving respawns the daemon with the new set (cloned on the next word).

const DEFAULT_NAMES = new Set(DEFAULT_PLUGINS.map((d) => d.name));

export function PluginsModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [plugins, setPlugins] = useState<Plugin[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [addName, setAddName] = useState("");
  const [addRepo, setAddRepo] = useState("");

  useEffect(() => {
    fetch(`/api/projects/${projectId}/plugins`)
      .then((r) => r.json())
      .then((d) => setPlugins(d.plugins ?? []))
      .catch(() => setPlugins([]));
  }, [projectId]);

  function toggle(name: string) {
    setPlugins((ps) => ps?.map((p) => (p.name === name ? { ...p, enabled: !p.enabled } : p)) ?? ps);
  }
  function remove(name: string) {
    setPlugins((ps) => ps?.filter((p) => p.name !== name) ?? ps);
  }
  function add() {
    const name = addName.trim();
    const repo = addRepo.trim();
    if (!isValidPluginName(name)) return setErr("Name: letters, digits, . _ - only.");
    if (!isValidPluginRepo(repo)) return setErr("Repo must be a github/gitlab/bitbucket https URL.");
    if (plugins?.some((p) => p.name === name)) return setErr("A plugin with that name already exists.");
    setErr(null);
    setPlugins((ps) => [...(ps ?? []), { name, repo, enabled: true, label: name }]);
    setAddName("");
    setAddRepo("");
  }

  async function save() {
    if (!plugins) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/plugins`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plugins }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "save failed");
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The registry would not take.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal plugins-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Plugins</h2>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="modal-sub">
          Skill repos the Phantom loads while it builds. Changes take effect on your next word —
          the chamber re-attunes with the new set.
        </p>

        <div className="plugin-list">
          {!plugins && <div className="plugin-loading">Reading the registry…</div>}
          {plugins?.map((p) => (
            <div className={`plugin-row${p.enabled ? " on" : ""}`} key={p.name}>
              <button
                className="plugin-toggle"
                role="switch"
                aria-checked={p.enabled}
                onClick={() => toggle(p.name)}
                title={p.enabled ? "Enabled" : "Disabled"}
              >
                <span className="knob" />
              </button>
              <div className="plugin-meta">
                <div className="plugin-name">
                  {p.label ?? p.name}
                  {DEFAULT_NAMES.has(p.name) ? (
                    <span className="plugin-tag builtin">BUILT-IN</span>
                  ) : (
                    <span className="plugin-tag custom">CUSTOM</span>
                  )}
                </div>
                <div className="plugin-grant">{p.grants ?? p.repo}</div>
              </div>
              {!DEFAULT_NAMES.has(p.name) && (
                <button className="plugin-del" onClick={() => remove(p.name)} aria-label="Remove">
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="plugin-add">
          <div className="plugin-add-head">Add a skill repo</div>
          <div className="plugin-add-fields">
            <input
              placeholder="name (e.g. my-skill)"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
            />
            <input
              placeholder="https://github.com/owner/repo"
              value={addRepo}
              onChange={(e) => setAddRepo(e.target.value)}
            />
            <button className="ghost-btn cyan" onClick={add} type="button">
              Add
            </button>
          </div>
        </div>

        {err && <div className="modal-err">{err}</div>}

        <div className="modal-foot">
          <button className="ghost-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="ghost-btn ecto" onClick={save} disabled={saving || !plugins}>
            {saving ? "Saving…" : "Save & re-attune"}
          </button>
        </div>
      </div>
    </div>
  );
}
