// The plugin registry model, shared client + server. A plugin is a
// self-contained Claude Code skill repo (has .claude-plugin/) cloned into the
// VM and handed to the Phantom via the SDK's `plugins` option. Per project the
// set is stored on phantom_projects.plugins; null means "the built-in default".

export type Plugin = {
  name: string; // dir name in ~/.phantom-plugins and the SDK plugin id
  repo: string; // git URL, shallow-cloned once per VM
  enabled: boolean;
  builtin?: boolean; // shipped by default; repo not user-editable
  label?: string; // human name for the UI
  grants?: string; // one line: what capability it adds
};

// The two plugins every project starts with. image-generation's scripts call
// Gemini/xAI directly, so the daemon env carries those keys into the VM.
export const DEFAULT_PLUGINS: Plugin[] = [
  {
    name: "ui-ux-pro-max",
    repo: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
    enabled: true,
    builtin: true,
    label: "UI/UX Pro Max",
    grants: "Design intelligence — styles, palettes, type pairings, layout, UX guidance.",
  },
  {
    name: "claude-image-generation",
    repo: "https://github.com/hex/claude-image-generation",
    enabled: true,
    builtin: true,
    label: "Image Generation",
    grants: "Conjure imagery in-VM via Gemini & Grok (xAI).",
  },
];

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,60}$/i;
const REPO_RE = /^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[\w.-]+\/[\w.-]+?(\.git)?$/i;

export function isValidPluginName(name: string): boolean {
  return NAME_RE.test(name);
}
export function isValidPluginRepo(repo: string): boolean {
  return REPO_RE.test(repo);
}

// Merge a stored list with the built-in defaults: defaults always present (only
// their `enabled` is user-controlled), then any custom plugins the user added.
export function resolvePlugins(stored: unknown): Plugin[] {
  const rows = Array.isArray(stored) ? (stored as Partial<Plugin>[]) : [];
  const byName = new Map(rows.map((r) => [String(r.name), r]));
  const out: Plugin[] = DEFAULT_PLUGINS.map((d) => {
    const s = byName.get(d.name);
    return { ...d, enabled: s ? s.enabled !== false : d.enabled };
  });
  const defaults = new Set(DEFAULT_PLUGINS.map((d) => d.name));
  for (const r of rows) {
    const name = String(r.name ?? "");
    const repo = String(r.repo ?? "");
    if (defaults.has(name)) continue;
    if (!isValidPluginName(name) || !isValidPluginRepo(repo)) continue;
    out.push({
      name,
      repo,
      enabled: r.enabled !== false,
      label: typeof r.label === "string" ? r.label.slice(0, 60) : name,
      grants: typeof r.grants === "string" ? r.grants.slice(0, 160) : undefined,
    });
  }
  return out;
}

export function enabledPlugins(plugins: Plugin[]): Plugin[] {
  return plugins.filter((p) => p.enabled);
}

export function pluginNames(plugins: Plugin[]): string {
  return enabledPlugins(plugins)
    .map((p) => p.name)
    .join(",");
}

// The shape persisted to the DB (drop UI-only fields for custom, keep enabled
// for built-ins). Built-ins store only {name, enabled}; custom store the repo.
export function toStored(plugins: Plugin[]): Partial<Plugin>[] {
  const defaults = new Set(DEFAULT_PLUGINS.map((d) => d.name));
  return plugins.map((p) =>
    defaults.has(p.name)
      ? { name: p.name, enabled: p.enabled }
      : { name: p.name, repo: p.repo, enabled: p.enabled, label: p.label, grants: p.grants },
  );
}
