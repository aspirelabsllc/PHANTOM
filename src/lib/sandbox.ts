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
