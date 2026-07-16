import { CodeSandbox } from "@codesandbox/sdk";
import { VARIANTS, VARIANT_META, type AssetFile, type Brand, type Variant } from "@/lib/brand";
import { DAEMON_SOURCE, DAEMON_VERSION } from "@/lib/vm/daemon-source";
import { buildClaudeMd } from "@/lib/claude-md";

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

// Silence the daemon + any agent still building ([p]hantom bracket trick:
// don't let pkill match this very command line).
export async function killDaemon(client: SbClient): Promise<void> {
  await client.commands.run(
    "(pkill -f '[p]hantom-daemon' || true); (pkill -f '[a]gent-runner' || true); (pkill -f '[c]laude-agent-sdk-linux' || true)",
  );
}

// Clear the daemon's conversation state (session + seq) so the next boot
// starts a fresh Phantom memory. The site files are untouched.
export async function resetDaemonState(sandboxId: string): Promise<void> {
  const { client } = await connectSandbox(sandboxId);
  await killDaemon(client);
  await client.commands.run("rm -f .phantom-daemon.json");
}

// Reset a project's site back to the starter scaffold: wipe everything the
// agent wrote and restore the original files, then nudge Vite.
export async function resetSandboxFiles(sandboxId: string): Promise<void> {
  const { client } = await connectSandbox(sandboxId);
  await killDaemon(client);
  await client.commands.run("rm -rf src designs public .git .phantom-daemon.json");
  for (const [path, content] of Object.entries(STARTER)) {
    await client.fs.writeTextFile(path, content);
  }
  await ensureGit(client);
  await client.commands.runBackground("pgrep -f 'vite' >/dev/null 2>&1 || npm run dev");
}

// Idempotent git checkpointing baseline for the rewind feature.
async function ensureGit(client: SbClient): Promise<void> {
  await client.commands.run(
    [
      "test -d .git || git init -q -b main",
      "git config user.email phantom@aspirelabs.dev",
      "git config user.name 'The Phantom'",
      "grep -q node_modules .gitignore 2>/dev/null || printf 'node_modules\\n.phantom-daemon.json\\nassets.json\\n' >> .gitignore",
      "git add -A",
      "(git diff --cached --quiet && git rev-parse HEAD >/dev/null 2>&1) || git commit -q -m 'checkpoint: scaffold' || true",
    ].join(" ; ") + " ; true",
  );
}

// Write/refresh the project CLAUDE.md inside the VM (brand kit + conventions).
export async function writeClaudeMd(
  client: SbClient,
  brand: Brand | null,
  chosen: Variant | null,
): Promise<void> {
  await client.fs.writeTextFile("CLAUDE.md", buildClaudeMd(brand, chosen));
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
// survives the pruning side of sync-assets.mjs.
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
  // providers directly, so the daemon env carries GEMINI_API_KEY/XAI_API_KEY
  // into the VM (a deliberate trade-off Salman chose over the /api/img proxy).
  { name: "claude-image-generation", repo: "https://github.com/hex/claude-image-generation" },
];
// passed to the daemon as PHANTOM_PLUGINS so it can resolve the cloned dirs
export const AGENT_PLUGIN_NAMES = AGENT_PLUGINS.map((p) => p.name).join(",");

// Write the daemon + tool scripts, ensure the Agent SDK is installed, clone
// the skill plugins, and prepare the browser harness (playwright + MCP).
export async function ensureBuilder(client: SbClient): Promise<void> {
  await client.fs.writeTextFile("phantom-daemon.mjs", DAEMON_SOURCE);
  await client.fs.writeTextFile("shot.mjs", SHOT_SCRIPT);
  await client.fs.writeTextFile("register-assets.mjs", REGISTER_SCRIPT);
  await client.fs.writeTextFile("sync-assets.mjs", SYNC_SCRIPT);
  await client.commands.run(
    "node -e \"require.resolve('@anthropic-ai/claude-agent-sdk')\" 2>/dev/null || npm install @anthropic-ai/claude-agent-sdk@0.3.207",
  );
  await ensureGit(client);
  // clone skill plugins (idempotent + shallow); never fail the build on this
  const dir = "$HOME/.phantom-plugins";
  const steps = [`mkdir -p ${dir}`];
  for (const p of AGENT_PLUGINS) {
    steps.push(
      `test -d ${dir}/${p.name}/.git || git clone --depth 1 --single-branch -q ${p.repo} ${dir}/${p.name}`,
    );
  }
  // drop leftovers from older VM generations (no longer used)
  steps.push(`rm -rf ${dir}/fullstack-dev-skills`, `rm -f image.mjs agent-runner.mjs`);
  // browser harness: playwright + chromium + the playwright MCP server in an
  // isolated dir (once per VM) — shot.mjs screenshots + MCP browser tools
  const tools = "$HOME/.phantom-tools";
  steps.push(`mkdir -p ${tools}`);
  steps.push(
    `test -d ${tools}/node_modules/playwright || (cd ${tools} && npm init -y >/dev/null 2>&1 && npm i playwright >/dev/null 2>&1)`,
  );
  steps.push(
    `test -d ${tools}/node_modules/@playwright/mcp || (cd ${tools} && npm i @playwright/mcp >/dev/null 2>&1)`,
  );
  steps.push(
    `test -d $HOME/.cache/ms-playwright || (cd ${tools} && npx --yes playwright install --with-deps chromium >/dev/null 2>&1)`,
  );
  await client.commands.run(steps.join(" ; ") + " ; true");
}

export type DaemonEnv = {
  token: string; // gateway session token (daemon kind)
  secret: string; // shared control-auth secret
  projectId: string;
};

// Make sure the daemon process is running and current. Respawns on version
// mismatch (deploys) and after VM wake-ups that killed it.
export async function ensureDaemon(client: SbClient, env: DaemonEnv): Promise<void> {
  const health = await client.commands.run(
    "curl -sf -m 2 http://localhost:8787/health || echo down",
  );
  if (health.includes(`"v":"${DAEMON_VERSION}"`)) return;
  await killDaemon(client);
  const gateway = `${process.env.APP_URL}/api/gw`;
  await client.commands.runBackground("node phantom-daemon.mjs", {
    env: {
      IS_SANDBOX: "1",
      ANTHROPIC_BASE_URL: gateway,
      ANTHROPIC_API_KEY: env.token,
      PHANTOM_ORIGIN: process.env.APP_URL ?? "",
      PHANTOM_DAEMON_SECRET: env.secret,
      PHANTOM_PROJECT: env.projectId,
      PHANTOM_PLUGINS: AGENT_PLUGIN_NAMES,
      ...(process.env.GEMINI_API_KEY ? { GEMINI_API_KEY: process.env.GEMINI_API_KEY } : {}),
      ...(process.env.XAI_API_KEY ? { XAI_API_KEY: process.env.XAI_API_KEY } : {}),
    },
  });
  // wait for the control server to come up (fresh spawn only)
  for (let i = 0; i < 20; i++) {
    const h = await client.commands.run("curl -sf -m 2 http://localhost:8787/health || echo down");
    if (h.includes('"ok":true')) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("The daemon would not wake.");
}

// A signed browser-reachable URL for the daemon's control port.
export async function daemonHostUrl(sandboxId: string): Promise<string> {
  const s = sdk();
  const token = await s.hosts.createToken(sandboxId, {
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  return s.hosts.getUrl({ sandboxId, token: token.token }, 8787);
}

