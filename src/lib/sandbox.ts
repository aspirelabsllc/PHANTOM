import { CodeSandbox } from "@codesandbox/sdk";

// The sandbox runtime for the Manifest — a CodeSandbox VM per project that
// holds a real Vite + React + Tailwind app the Phantom agent builds.

const DEV_PORT = 5173;

function sdk() {
  return new CodeSandbox(process.env.CSB_API_KEY);
}

// The Vite + React + Tailwind starter every project's site begins from.
const STARTER: Record<string, string> = {
  "package.json": JSON.stringify(
    {
      name: "phantom-site",
      private: true,
      type: "module",
      scripts: { dev: "vite --host" },
      dependencies: { react: "^18.3.1", "react-dom": "^18.3.1" },
      devDependencies: {
        "@anthropic-ai/claude-agent-sdk": "^0.3.207",
        "@vitejs/plugin-react": "^4.3.4",
        "@tailwindcss/vite": "^4.0.0",
        tailwindcss: "^4.0.0",
        vite: "^6.0.7",
      },
    },
    null,
    2,
  ),
  "vite.config.js": `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: true, port: ${DEV_PORT}, strictPort: true, allowedHosts: true },
});
`,
  "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Phantom Site</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
  "src/main.jsx": `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
  "src/index.css": `@import "tailwindcss";
`,
  "src/App.jsx": `export default function App() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center">
      <div className="text-center">
        <p className="text-xs tracking-[0.3em] uppercase text-neutral-500 mb-4">
          The vapor is condensing
        </p>
        <h1 className="text-4xl font-light tracking-tight">The form is taking shape.</h1>
        <p className="mt-4 text-neutral-400">Speak to the Phantom and this site will build itself.</p>
      </div>
    </main>
  );
}
`,
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
      const client = await sb.connect();
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

// Resume a sandbox, connect, ensure the dev server is up, and return the client
// plus a fresh preview URL.
export async function connectSandbox(
  sandboxId: string,
): Promise<{ client: SbClient; previewUrl: string }> {
  const s = sdk();
  const sb = await s.sandboxes.resume(sandboxId);
  const client = (await sb.connect()) as unknown as SbClient;
  await client.commands.runBackground(`pgrep -f 'vite' >/dev/null 2>&1 || npm run dev`);
  const token = await s.hosts.createToken(sandboxId, {
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const previewUrl = s.hosts.getUrl({ sandboxId, token: token.token }, DEV_PORT);
  return { client, previewUrl };
}

// The agent runner that runs INSIDE the sandbox. It reaches Anthropic only
// through our gateway (ANTHROPIC_BASE_URL) with a session token as its key.
export const AGENT_RUNNER = [
  "import { query } from '@anthropic-ai/claude-agent-sdk';",
  "import { existsSync } from 'node:fs';",
  "const prompt = process.env.PHANTOM_PROMPT || '';",
  "const brand = process.env.PHANTOM_BRAND || '{}';",
  "const resume = process.env.PHANTOM_SESSION || '';",
  "const pluginBase = (process.env.HOME || '/root') + '/.phantom-plugins';",
  "const plugins = (process.env.PHANTOM_PLUGINS || '').split(',').filter(Boolean)",
  "  .map((n) => pluginBase + '/' + n).filter((p) => existsSync(p))",
  "  .map((path) => ({ type: 'local', path }));",
  "const emit = (o) => console.log(JSON.stringify(o));",
  "const system = [",
  "  'You are the Phantom — you build a real website inside this Vite + React + Tailwind project (already scaffolded).',",
  "  'Edit files under src/ (mainly src/App.jsx, and new components under src/). Style everything with Tailwind utility classes.',",
  "  'Honor the brand kit below exactly: use its colors (hex), type pairing, and voice; NEVER violate any hard compliance rule.',",
  "  'Keep the app building: valid JSX and imports. Do not touch package.json, vite.config.js, or node_modules.',",
  "  'Work decisively — read only what you need, then write the files. Stop when the change is done.',",
  "  '',",
  "  'BRAND KIT (JSON):',",
  "  brand,",
  "].join(String.fromCharCode(10));",
  "const base = {",
  "  model: 'claude-opus-4-8',",
  "  systemPrompt: system,",
  "  cwd: process.cwd(),",
  "  allowedTools: ['Read','Write','Edit','Bash','Glob','Grep'],",
  "  permissionMode: 'bypassPermissions',",
  "  maxTurns: 40,",
  "};",
  "if (plugins.length) base.plugins = plugins;",
  "let sawStream = false;",
  "async function run(options) {",
  "  for await (const m of query({ prompt, options })) {",
  "    sawStream = true;",
  "    if (m.type === 'system' && m.subtype === 'init' && m.session_id) { emit({ t: 'session', id: m.session_id }); }",
  "    if (m.type === 'assistant' && m.message) {",
  "      for (const b of m.message.content) {",
  "        if (b.type === 'text' && b.text) emit({ t: 'text', text: b.text });",
  "        else if (b.type === 'tool_use') { const i = b.input || {}; emit({ t: 'tool', verb: b.name, target: i.file_path || i.path || i.pattern || i.command || '' }); }",
  "      }",
  "    } else if (m.type === 'result') { if (m.session_id) emit({ t: 'session', id: m.session_id }); emit({ t: 'result', subtype: m.subtype }); }",
  "  }",
  "}",
  "try {",
  "  try { await run(resume ? { ...base, resume } : base); }",
  "  catch (e) { if (resume && !sawStream) { await run(base); } else { throw e; } }",
  "} catch (e) { emit({ t: 'error', message: String((e && e.message) || e) }); }",
  "emit({ t: 'end' });",
].join("\n");

// Skill plugins cloned into the VM and handed to the agent via the SDK's
// `plugins` option. Each repo is a self-contained plugin (has .claude-plugin/).
// Cloned once per sandbox, outside the site cwd so the agent never touches them.
const AGENT_PLUGINS: { name: string; repo: string }[] = [
  { name: "ui-ux-pro-max", repo: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill" },
  { name: "fullstack-dev-skills", repo: "https://github.com/jeffallan/claude-skills" },
];
// passed to the runner as PHANTOM_PLUGINS so it can resolve the cloned dirs
export const AGENT_PLUGIN_NAMES = AGENT_PLUGINS.map((p) => p.name).join(",");

// Write the runner, ensure the Agent SDK is installed, and clone the skill
// plugins into the VM.
export async function ensureBuilder(client: SbClient): Promise<void> {
  await client.fs.writeTextFile("agent-runner.mjs", AGENT_RUNNER);
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
  await client.commands.run(steps.join(" ; ") + " ; true");
}
