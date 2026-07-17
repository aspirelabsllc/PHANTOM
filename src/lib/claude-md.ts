import type { Brand, Variant } from "@/lib/brand";
import { VARIANT_META, VARIANTS } from "@/lib/brand";

// The project CLAUDE.md written into the VM — the natural Claude Code way to
// carry the brand kit and site conventions. Loaded by the daemon session via
// settingSources: ['project']; rewritten whenever the brand or claim changes.

export function buildClaudeMd(brand: Brand | null, chosen: Variant | null): string {
  const lines: string[] = [
    "# PHANTOM SITE — agent guide",
    "",
    "One static site: plain HTML + Tailwind v4 + light vanilla JS. Vite is the dev",
    "server ONLY (port 5173, already running) — no build steps, no frameworks, no React.",
    "",
    "## Layout",
    "- Three design variants (apparitions) live side by side:",
    ...VARIANTS.map(
      (v) =>
        `  - designs/${v}/ — apparition ${VARIANT_META[v].numeral} (${VARIANT_META[v].mode})`,
    ),
    chosen
      ? `- CLAIMED FORM: designs/${chosen}/ is THE site. Work addresses it unless told otherwise.`
      : "- No form claimed yet — the summons is open; all three build in parallel.",
    "- public/assets/ — brand assets, served at /assets/<file>. public/assets/manifest.json lists them.",
    "- Never touch: root index.html, package.json, vite.config.js, node_modules, the tool scripts (*.mjs).",
    "",
    "## Conventions",
    "- Every page is a complete HTML document linking its own styles.css relatively.",
    "- Tailwind utilities in class attributes; custom CSS (@font-face, keyframes, bespoke effects)",
    "  in the design's styles.css BELOW the `@import \"tailwindcss\";` line.",
    "",
    "### Tailwind v4 (NOT v3 — do not emit v3 syntax)",
    "- Stylesheet is a single `@import \"tailwindcss\";` — never `@tailwind base/components/utilities`.",
    "- Theme tokens (brand colors, fonts, radii) go in CSS via `@theme { --color-...: ...; }`.",
    "- There is NO tailwind.config.js and no `content` array — never create one.",
    "- Use current utility names (opacity via `/` e.g. `bg-black/50`, not `bg-opacity-50`).",
    "- When unsure of any current API, query the Context7 MCP before writing (see Tooling).",
    "",
    "### Tooling available (use it — don't guess from memory)",
    "- Context7 MCP — live, version-correct docs for any library (Tailwind v4, GSAP, Three.js…).",
    "- GitMCP — keyless docs fallback for any GitHub repo.",
    "- better-icons MCP — Iconify token + SVG from a description; never hand-draw icon paths.",
    "- gsap-skills — official GreenSock motion craft (scroll, timeline, SplitText); GSAP is free.",
    "- playwright MCP — drive the live preview to verify interaction/motion, not just screenshots.",
    "- Motion is the differentiator: GSAP + ScrollTrigger + SplitText for hero/scroll work; native",
    "  CSS `animation-timeline: view()` for light reveals. Always honor prefers-reduced-motion.",
    "- Rich interactive widgets (modal, dropdown, tabs, tooltip, drawer) without hand-rolling JS:",
    "  Web Awesome web components (framework-free `<wa-*>` tags, load from CDN). Query Context7",
    "  ('webawesome') for the current tag API. Use when a design needs real interactive UI.",
    "- Brand fonts: @font-face pointing at /assets/<file>. Prefer real vault assets over placeholders.",
    "- Conjured imagery (max 4 per design, only after the page is built):",
    "  `bash $HOME/.phantom-plugins/claude-image-generation/scripts/gemini.sh --mode generate --prompt \"...\" --aspect-ratio 16:9 --output public/assets/<fresh-slug>.png`",
    "  (or xai.sh; edit with `--mode edit --input-image public/assets/<file>`). Fresh slugs only —",
    "  never overwrite an existing asset. Reference as /assets/<slug>.png; they register to the vault automatically.",
    "- Screenshots: `node shot.mjs /tmp/<name>.png desktop|tablet|phone /designs/<variant>/` then Read the PNG.",
    "- Browser checks: playwright MCP tools against http://localhost:5173.",
    "- Never run git — the chamber commits each finished turn itself.",
    "",
  ];

  if (brand) {
    lines.push("## BRAND KIT", "", "```json", JSON.stringify(brand, null, 2), "```", "");
    const hard = brand.compliance?.rules ?? [];
    if (hard.length) {
      lines.push(
        "## HARD COMPLIANCE RULES (law for every variant, including unbound)",
        ...hard.map((r) => `- ${r.text}`),
        "",
      );
    }
  } else {
    lines.push("## BRAND KIT", "", "Not yet drawn — build from the invoker's words alone.", "");
  }

  return lines.join("\n");
}
