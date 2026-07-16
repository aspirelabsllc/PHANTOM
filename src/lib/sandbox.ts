import { CodeSandbox } from "@codesandbox/sdk";
import { VARIANTS, VARIANT_META, type AssetFile } from "@/lib/brand";

// The sandbox runtime for the Manifest — a CodeSandbox VM per project that
// holds a real Vite + Tailwind static site (plain HTML/CSS/JS, no framework)
// the Phantom agent builds. Three designs live side by side under designs/.

const DEV_PORT = 5173;

// Bump when the STARTER layout changes shape; older VMs migrate on connect.
const STARTER_VERSION = "2";
const STARTER_MARKER = ".phantom-starter";

function sdk() {
  return new CodeSandbox(process.env.CSB_API_KEY);
}

function variantPlaceholder(v: (typeof VARIANTS)[number]): string {
  const meta = VARIANT_META[v];
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Apparition ${meta.numeral} — not yet condensed</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body class="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center">
    <main class="text-center px-6">
      <p class="text-xs tracking-[0.3em] uppercase text-neutral-500 mb-4">Apparition ${meta.numeral} · ${meta.label}</p>
      <h1 class="text-4xl font-light tracking-tight">This form has not yet condensed.</h1>
      <p class="mt-4 text-neutral-400">Speak to the Phantom and it will take shape.</p>
    </main>
    <script src="./script.js"></script>
  </body>
</html>
`;
}

const VARIANT_CSS = `@import "tailwindcss";

/* Custom CSS for this design (@font-face, keyframes, bespoke effects) lives below. */
`;

// The plain-HTML + Tailwind starter every project's site begins from. Vite
// stays purely as the dev server (HMR + preview); the site itself is static.
const STARTER: Record<string, string> = {
  [STARTER_MARKER]: STARTER_VERSION,
  "package.json": JSON.stringify(
    {
      name: "phantom-site",
      private: true,
      type: "module",
      scripts: { dev: "vite --host" },
      devDependencies: {
        "@anthropic-ai/claude-agent-sdk": "^0.3.207",
        "@tailwindcss/vite": "^4.0.0",
        tailwindcss: "^4.0.0",
        vite: "^6.0.7",
      },
    },
    null,
    2,
  ),
  "vite.config.js": `import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  appType: 'mpa',
  plugins: [tailwindcss()],
  server: { host: true, port: ${DEV_PORT}, strictPort: true, allowedHosts: true },
});
`,
  "styles.css": `@import "tailwindcss";
`,
  "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Phantom Site</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body class="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center">
    <main class="text-center px-6">
      <p class="text-xs tracking-[0.3em] uppercase text-neutral-500 mb-4">The vapor is condensing</p>
      <h1 class="text-4xl font-light tracking-tight">Three forms are taking shape.</h1>
      <nav class="mt-8 flex gap-6 justify-center text-sm text-neutral-400">
        <a class="underline underline-offset-4 hover:text-neutral-100" href="/designs/one/">Apparition I</a>
        <a class="underline underline-offset-4 hover:text-neutral-100" href="/designs/two/">Apparition II</a>
        <a class="underline underline-offset-4 hover:text-neutral-100" href="/designs/three/">Apparition III</a>
      </nav>
    </main>
  </body>
</html>
`,
  "public/assets/manifest.json": "[]\n",
  ...Object.fromEntries(
    VARIANTS.flatMap((v) => [
      [`designs/${v}/index.html`, variantPlaceholder(v)],
      [`designs/${v}/styles.css`, VARIANT_CSS],
      [`designs/${v}/script.js`, "// Light interactivity for this design lives here.\n"],
    ]),
  ),
};

export type BootResult = { sandboxId: string; previewUrl: string; created: boolean };

// Boot (or wake) a project's sandbox and return a signed preview URL.
export async function bootSandbox(existingId: string | null): Promise<BootResult> {
  const s = sdk();
  let sandboxId = existingId;
  let created = false;

  // wake an existing sandbox; if it's gone, fall through to create
  if (sandboxId) {
    try {
      const sb = await s.sandboxes.resume(sandboxId);
      const client = (await sb.connect()) as unknown as SbClient;
      await ensureStarter(client);
      // ensure the dev server is up (it may have died while hibernated)
      await client.commands.runBackground(
        `pgrep -f 'vite' >/dev/null 2>&1 || npm run dev`,
      );
    } catch {
      sandboxId = null;
    }
  }

  if (!sandboxId) {
    const sb = await s.sandboxes.create();
    sandboxId = sb.id;
    const client = await sb.connect();
    for (const [path, content] of Object.entries(STARTER)) {
      await client.fs.writeTextFile(path, content);
    }
    await client.commands.run("npm install");
    await client.commands.runBackground("npm run dev");
    created = true;
  }

  const token = await s.hosts.createToken(sandboxId, {
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const previewUrl = s.hosts.getUrl({ sandboxId, token: token.token }, DEV_PORT);
  return { sandboxId, previewUrl, created };
}

// Minimal shape of the connected sandbox client we use.
type SbCommand = {
  onOutput: (cb: (chunk: string) => void) => { dispose: () => void };
  onStatusChange: (cb: (s: string) => void) => { dispose: () => void };
  kill?: () => Promise<void>;
};
export type SbClient = {
  fs: { writeTextFile: (path: string, content: string) => Promise<unknown> };
  commands: {
    run: (cmd: string, opts?: { env?: Record<string, string> }) => Promise<string>;
    runBackground: (cmd: string, opts?: { env?: Record<string, string> }) => Promise<SbCommand>;
  };
};

// Migrate a VM that predates the current starter layout (e.g. the React-era
// scaffold): rewrite the scaffold files, drop the dead React app, and let
// Vite restart itself off the config change. Idempotent and cheap when current.
export async function ensureStarter(client: SbClient): Promise<void> {
  const v = (await client.commands.run(`cat ${STARTER_MARKER} 2>/dev/null || true`)).trim();
  if (v === STARTER_VERSION) return;
  for (const [path, content] of Object.entries(STARTER)) {
    await client.fs.writeTextFile(path, content);
  }
  await client.commands.run("rm -rf src");
}

// Resume a sandbox, connect, ensure the dev server is up, and return the client
// plus a fresh preview URL.
export async function connectSandbox(
  sandboxId: string,
): Promise<{ client: SbClient; previewUrl: string }> {
  const s = sdk();
  const sb = await s.sandboxes.resume(sandboxId);
  const client = (await sb.connect()) as unknown as SbClient;
  await ensureStarter(client);
  await client.commands.runBackground(`pgrep -f 'vite' >/dev/null 2>&1 || npm run dev`);
  const token = await s.hosts.createToken(sandboxId, {
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const previewUrl = s.hosts.getUrl({ sandboxId, token: token.token }, DEV_PORT);
  return { client, previewUrl };
}

// Reset a project's site back to the starter scaffold: wipe everything the
// agent wrote and restore the original files, then nudge Vite.
export async function resetSandboxFiles(sandboxId: string): Promise<void> {
  const { client } = await connectSandbox(sandboxId);
  // silence any apparitions still building — their dirs are about to vanish
  // ([a]gent bracket trick: don't let pkill match this very command line)
  await client.commands.run(
    "(pkill -f '[a]gent-runner' || true); (pkill -f '[c]laude-agent-sdk-linux' || true)",
  );
  await client.commands.run("rm -rf src designs public");
  for (const [path, content] of Object.entries(STARTER)) {
    await client.fs.writeTextFile(path, content);
  }
  await client.commands.runBackground("pgrep -f 'vite' >/dev/null 2>&1 || npm run dev");
}

// Push the vault's assets into the VM: sync-assets.mjs downloads what's
// missing, prunes what was removed, and rewrites public/assets/manifest.json.
export async function syncAssets(client: SbClient, files: AssetFile[]): Promise<void> {
  const manifest = files.map((f) => ({
    file: f.file,
    type: f.type,
    ...(f.face ? { face: f.face } : {}),
    origin: f.origin ?? "offered",
    ...(f.note ? { note: f.note } : {}),
  }));
  const spec = { files: files.map(({ file, url }) => ({ file, url })), manifest };
  await client.fs.writeTextFile("assets.json", JSON.stringify(spec, null, 2));
  await client.commands.run("node sync-assets.mjs");
}

// The agent runner that runs INSIDE the sandbox. It reaches Anthropic only
// through our gateway (ANTHROPIC_BASE_URL) with a session token as its key.
export const AGENT_RUNNER = [
  "import { query } from '@anthropic-ai/claude-agent-sdk';",
  "import { existsSync } from 'node:fs';",
  "import { execSync } from 'node:child_process';",
  "const prompt = process.env.PHANTOM_PROMPT || '';",
  "const brand = process.env.PHANTOM_BRAND || '{}';",
  "const resume = process.env.PHANTOM_SESSION || '';",
  "const variant = process.env.PHANTOM_VARIANT || 'one';",
  "const faithful = process.env.PHANTOM_MODE !== 'unbound';",
  "const direction = process.env.PHANTOM_DIRECTION || '';",
  "const dir = 'designs/' + variant;",
  "const pluginBase = (process.env.HOME || '/root') + '/.phantom-plugins';",
  "const plugins = (process.env.PHANTOM_PLUGINS || '').split(',').filter(Boolean)",
  "  .map((n) => pluginBase + '/' + n).filter((p) => existsSync(p))",
  "  .map((path) => ({ type: 'local', path }));",
  "const emit = (o) => console.log(JSON.stringify(o));",
  "const system = [",
  "  'You are the Phantom — you build one real static site inside this Vite + Tailwind v4 project: plain HTML, modern CSS, and light vanilla JS. No React, no frameworks, no build steps.',",
  "  'Your site lives in ' + dir + '/ — edit ONLY inside that directory: index.html, styles.css, script.js (add more pages or partials there if needed, linked relatively). NEVER touch other design directories, the root index.html, package.json, vite.config.js, or node_modules.',",
  "  'The invoker speaks to the whole summons at once — their words may describe several designs. Regardless: YOU produce exactly ONE design, yours, in ' + dir + '/. Never build multiple designs or write into any other directory.',",
  "  'Style with Tailwind utility classes in class attributes; put custom CSS (@font-face, keyframes, bespoke effects) in styles.css BELOW the @import \"tailwindcss\" line.',",
  "  'Brand assets are served at /assets/<file> (they live in public/assets/). Read public/assets/manifest.json to see what exists — logos, product shots, fonts, conjured imagery. Prefer real assets over placeholders or external stock URLs; load brand fonts with @font-face pointing at /assets/<file>.',",
  "  'Build the page FIRST, completely, using existing vault assets and tasteful non-image treatments (color fields, gradients, type) as stand-ins. Only THEN conjure new imagery — at most 4 images for your design — and swap it in. To conjure use the image-generation plugin scripts: `bash $HOME/.phantom-plugins/claude-image-generation/scripts/gemini.sh --mode generate --prompt \"rich, specific prompt: subject, style, lighting, palette\" --aspect-ratio 16:9 --output public/assets/<slug>.png` (or xai.sh for Grok; edit an existing image with --mode edit --input-image public/assets/<file>). Only gemini + xai are available (no OpenAI key). ALWAYS write outputs into public/assets/ under a fresh descriptive slug — never reuse an existing asset filename — and reference them as /assets/<slug>.png; they register into the vault automatically.',",
  "  'For any design or UI work, FIRST invoke the ui-ux-pro-max skill and apply its guidance on styles, color palettes, type pairings, layout, and UX — always subordinate to the rules below.',",
  "  faithful",
  "    ? 'Honor the brand kit below exactly: use its colors (hex), type pairing, and voice; NEVER violate any hard compliance rule.'",
  "    : 'You are the UNBOUND apparition. From the kit below take ONLY the brand name, the real content and offerings, and the HARD compliance rules — those rules are law. Everything else (palette, typography, voice, layout, art direction) you invent fresh: be original and daring, and deliberately depart from the kit look.',",
  "  direction ? 'ART DIRECTION for this apparition: ' + direction : '',",
  "  'Keep the site valid: every page a complete HTML document linking its own styles.css. SEE your work before finishing: run `node shot.mjs /tmp/shot.png desktop /' + dir + '/` (also pass tablet or phone to check responsive), then Read /tmp/shot.png to view the actual rendered page. Critique it honestly — layout, spacing, hierarchy, color, contrast, overflow, broken or empty elements — and fix what looks off. Repeat the screenshot until it genuinely looks good.',",
  "  'Work decisively — read only what you need, then write the files. Stop when the change is done and it looks right.',",
  "  '',",
  "  'BRAND KIT (JSON):',",
  "  brand,",
  "].filter(Boolean).join(String.fromCharCode(10));",
  "const base = {",
  "  model: 'claude-opus-4-8',",
  "  systemPrompt: system,",
  "  cwd: process.cwd(),",
  "  allowedTools: ['Read','Write','Edit','Bash','Glob','Grep'],",
  "  permissionMode: 'bypassPermissions',",
  "  maxTurns: 40,",
  "  skills: ['ui-ux-pro-max:ui-ux-pro-max','ui-ux-pro-max:design','ui-ux-pro-max:design-system','ui-ux-pro-max:ui-styling','ui-ux-pro-max:brand','ui-ux-pro-max:banner-design','ui-ux-pro-max:slides','claude-image-generation:image-generation'],",
  "};",
  "if (plugins.length) base.plugins = plugins;",
  "let sawStream = false;",
  "let currentSession = resume || '';",
  "const accLogs = [];",
  "let accReply = '';",
  "let fatal = null;",
  "async function run(options) {",
  "  for await (const m of query({ prompt, options })) {",
  "    sawStream = true;",
  "    if (m.session_id) currentSession = m.session_id;",
  "    if (m.type === 'system' && m.subtype === 'init' && m.session_id) { emit({ t: 'session', id: m.session_id }); }",
  "    if (m.type === 'assistant' && m.message) {",
  "      for (const b of m.message.content) {",
  "        if (b.type === 'text' && b.text) { accReply += (accReply ? ' ' : '') + b.text; emit({ t: 'text', text: b.text }); }",
  "        else if (b.type === 'tool_use') { const i = b.input || {}; const row = { verb: b.name, target: String(i.file_path || i.path || i.pattern || i.command || '').slice(0, 160) }; accLogs.push(row); emit({ t: 'tool', verb: row.verb, target: row.target }); }",
  "      }",
  "    } else if (m.type === 'result') { if (m.session_id) emit({ t: 'session', id: m.session_id }); emit({ t: 'result', subtype: m.subtype }); }",
  "  }",
  "}",
  "const transient = (e) => /connection closed|overloaded|rate limit|too many requests|429|500|502|503|504|529|ECONNRESET|ETIMEDOUT|socket hang up|terminated|fetch failed|stalled|timed? out|timeout/i.test(String((e && e.message) || e));",
  "let attempt = 0;",
  "while (true) {",
  "  try {",
  "    if (attempt === 0) { await run(resume ? { ...base, resume } : base); }",
  "    else { await run(currentSession ? { ...base, resume: currentSession } : base); }",
  "    break;",
  "  } catch (e) {",
  "    if (attempt === 0 && resume && !sawStream) { try { await run(base); break; } catch (e2) { e = e2; } }",
  "    if (transient(e) && attempt < 4) { attempt++; emit({ t: 'text', text: '(Connection dropped — resuming the build…)' }); await new Promise((r) => setTimeout(r, 1500 * attempt)); continue; }",
  "    fatal = String((e && e.message) || e); emit({ t: 'error', message: fatal }); break;",
  "  }",
  "}",
  "// Report home from INSIDE the VM — the HTTP route that spawned us may be",
  "// long dead (Railway cuts streams at 15 min); this is the durable path.",
  "const origin = (process.env.ANTHROPIC_BASE_URL || '').replace(/\\/api\\/gw\\/?$/, '');",
  "try {",
  "  const res = await fetch(origin + '/api/turn', {",
  "    method: 'POST',",
  "    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (process.env.ANTHROPIC_API_KEY || '') },",
  "    body: JSON.stringify({ variant, session: currentSession, reply: accReply, logs: accLogs.slice(-300), error: fatal }),",
  "  });",
  "  if (!res.ok) emit({ t: 'text', text: '(Turn report refused: HTTP ' + res.status + ')' });",
  "} catch (e) { emit({ t: 'text', text: '(Could not report the turn home: ' + e.message + ')' }); }",
  "try { execSync('node register-assets.mjs', { stdio: 'ignore', timeout: 180000 }); } catch {}",
  "emit({ t: 'end' });",
].join("\n");

// The screenshot harness the agent runs to actually see the rendered site.
// Playwright lives in an isolated dir ($HOME/.phantom-tools) so the built
// site's own dependencies stay clean; createRequire resolves it from there.
const SHOT_SCRIPT = [
  "import { createRequire } from 'node:module';",
  "const require = createRequire(process.env.HOME + '/.phantom-tools/');",
  "const { chromium } = require('playwright');",
  "const out = process.argv[2] || '/tmp/shot.png';",
  "const device = process.argv[3] || 'desktop';",
  "const path = process.argv[4] || '/';",
  "const sizes = { desktop: { width: 1280, height: 800 }, tablet: { width: 834, height: 1112 }, phone: { width: 390, height: 844 } };",
  "const viewport = sizes[device] || sizes.desktop;",
  "const b = await chromium.launch();",
  "const p = await b.newPage({ viewport });",
  "await p.goto('http://localhost:5173' + path, { waitUntil: 'networkidle', timeout: 30000 });",
  "await p.screenshot({ path: out, fullPage: true });",
  "await b.close();",
  "console.log('shot saved:', out, '(' + device + ' ' + path + ')');",
].join("\n");

// Reverse sync: anything the agent dropped into public/assets/ that the vault
// doesn't know yet (plugin-generated imagery) is uploaded to /api/img/register
// with the session token, so it lands in Supabase, shows in the panel, and
// survives the pruning side of sync-assets.mjs. Runs before sync and after
// every build turn.
const REGISTER_SCRIPT = [
  "import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';",
  "const origin = (process.env.ANTHROPIC_BASE_URL || '').replace(/\\/api\\/gw\\/?$/, '');",
  "const token = process.env.ANTHROPIC_API_KEY || '';",
  "if (!existsSync('public/assets')) { console.log('registered 0 new asset(s)'); process.exit(0); }",
  "let m = []; try { m = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')); } catch {}",
  "const known = new Set(m.map((e) => e.file));",
  "known.add('manifest.json');",
  "let n = 0;",
  "for (const f of readdirSync('public/assets')) {",
  "  if (known.has(f)) continue;",
  "  const p = 'public/assets/' + f;",
  "  if (!statSync(p).isFile()) continue;",
  "  const b64 = readFileSync(p).toString('base64');",
  "  try {",
  "    const res = await fetch(origin + '/api/img/register', {",
  "      method: 'POST',",
  "      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },",
  "      body: JSON.stringify({ file: f, b64 }),",
  "    });",
  "    if (!res.ok) { console.error('register failed for ' + f + ': HTTP ' + res.status + ' — ' + (await res.text()).slice(0, 200)); continue; }",
  "    m.push({ file: f, type: 'image', origin: 'conjured' });",
  "    n++;",
  "  } catch (e) { console.error('register failed for ' + f + ': ' + e.message); }",
  "}",
  "writeFileSync('public/assets/manifest.json', JSON.stringify(m, null, 2));",
  "console.log('registered ' + n + ' new asset(s)');",
].join("\n");

// Reconciles public/assets/ against the vault snapshot in assets.json:
// downloads missing files by signed URL, prunes files no longer in the vault,
// and rewrites manifest.json. Runs inside the VM (node 20+, global fetch).
const SYNC_SCRIPT = [
  "import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';",
  "const spec = JSON.parse(readFileSync('assets.json', 'utf8'));",
  "mkdirSync('public/assets', { recursive: true });",
  "const keep = new Set(spec.files.map((f) => f.file));",
  "keep.add('manifest.json');",
  "for (const f of readdirSync('public/assets')) {",
  "  if (!keep.has(f)) rmSync('public/assets/' + f, { force: true, recursive: true });",
  "}",
  "for (const f of spec.files) {",
  "  const p = 'public/assets/' + f.file;",
  "  if (existsSync(p) || !f.url) continue;",
  "  try {",
  "    const r = await fetch(f.url);",
  "    if (!r.ok) { console.error('skip ' + f.file + ': HTTP ' + r.status); continue; }",
  "    writeFileSync(p, Buffer.from(await r.arrayBuffer()));",
  "  } catch (e) { console.error('skip ' + f.file + ': ' + e.message); }",
  "}",
  "writeFileSync('public/assets/manifest.json', JSON.stringify(spec.manifest, null, 2));",
  "console.log('assets in sync: ' + spec.files.length);",
].join("\n");

// Skill plugins cloned into the VM and handed to the agent via the SDK's
// `plugins` option. Each repo is a self-contained plugin (has .claude-plugin/).
// Cloned once per sandbox, outside the site cwd so the agent never touches them.
const AGENT_PLUGINS: { name: string; repo: string }[] = [
  { name: "ui-ux-pro-max", repo: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill" },
  // Gemini/xAI image generation via shell scripts. NOTE: its scripts call the
  // providers directly, so the build route passes GEMINI_API_KEY/XAI_API_KEY
  // into the VM (a deliberate trade-off Salman chose over the /api/img proxy).
  { name: "claude-image-generation", repo: "https://github.com/hex/claude-image-generation" },
];
// passed to the runner as PHANTOM_PLUGINS so it can resolve the cloned dirs
export const AGENT_PLUGIN_NAMES = AGENT_PLUGINS.map((p) => p.name).join(",");

// Write the runner + tool scripts, ensure the Agent SDK is installed, and
// clone the skill plugins into the VM.
export async function ensureBuilder(client: SbClient): Promise<void> {
  await client.fs.writeTextFile("agent-runner.mjs", AGENT_RUNNER);
  await client.fs.writeTextFile("shot.mjs", SHOT_SCRIPT);
  await client.fs.writeTextFile("register-assets.mjs", REGISTER_SCRIPT);
  await client.fs.writeTextFile("sync-assets.mjs", SYNC_SCRIPT);
  await client.commands.run(
    "node -e \"require.resolve('@anthropic-ai/claude-agent-sdk')\" 2>/dev/null || npm install @anthropic-ai/claude-agent-sdk@0.3.207",
  );
  // clone skill plugins (idempotent + shallow); never fail the build on this
  const dir = "$HOME/.phantom-plugins";
  const steps = [`mkdir -p ${dir}`];
  for (const p of AGENT_PLUGINS) {
    steps.push(
      `test -d ${dir}/${p.name}/.git || git clone --depth 1 --single-branch -q ${p.repo} ${dir}/${p.name}`,
    );
  }
  // drop leftovers from older VM generations (no longer used)
  steps.push(`rm -rf ${dir}/fullstack-dev-skills`, `rm -f image.mjs`);
  // browser harness: Playwright + chromium in an isolated dir (once per VM),
  // so `node shot.mjs` can screenshot the live preview for the agent to see
  const tools = "$HOME/.phantom-tools";
  steps.push(`mkdir -p ${tools}`);
  steps.push(
    `test -d ${tools}/node_modules/playwright || (cd ${tools} && npm init -y >/dev/null 2>&1 && npm i playwright >/dev/null 2>&1)`,
  );
  steps.push(
    `test -d $HOME/.cache/ms-playwright || (cd ${tools} && npx --yes playwright install --with-deps chromium >/dev/null 2>&1)`,
  );
  await client.commands.run(steps.join(" ; ") + " ; true");
}
