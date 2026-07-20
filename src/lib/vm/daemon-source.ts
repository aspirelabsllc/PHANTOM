// The Phantom daemon — the persistent agent session that lives INSIDE the
// CodeSandbox VM. Uploaded verbatim by ensureBuilder() and kept alive across
// turns, so the conversation behaves like a local Claude Code session:
// streaming input, interrupt, queued messages, durable event stream.
//
// The source is a template literal (not a file read) so it ships inside the
// Next.js bundle. RULES for editing: no backticks and no "${" inside the
// daemon code — use string concatenation.

// Bump to force a daemon respawn on deploy (ensureDaemon compares /health).
export const DAEMON_VERSION = "11";

export const DAEMON_SOURCE = `// phantom-daemon.mjs (generated — do not edit in the VM)
import { createServer, get as httpGet } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { query } from '@anthropic-ai/claude-agent-sdk';

const VERSION = '${DAEMON_VERSION}';
const PORT = 8787;
const SECRET = process.env.PHANTOM_DAEMON_SECRET || '';
const ORIGIN = process.env.PHANTOM_ORIGIN || '';
const MODEL = process.env.PHANTOM_MODEL || 'claude-opus-4-8';
const STATE_FILE = '.phantom-daemon.json';
const HOME = process.env.HOME || '/root';
const PLUGIN_BASE = HOME + '/.phantom-plugins';
const TOOLS = HOME + '/.phantom-tools';

// ---------- persistent state ----------
let state = { sessionId: '', seq: 0 };
try { state = Object.assign(state, JSON.parse(readFileSync(STATE_FILE, 'utf8'))); } catch {}
// Never reuse a seq the DB already holds: a recreated VM starts with a fresh
// state file (seq 0) but the project's phantom_events still carry old seqs.
// The app passes the current DB max so our stream stays strictly monotonic.
state.seq = Math.max(state.seq, Number(process.env.PHANTOM_SEQ_BASE || 0));
let stateDirty = false;
function saveState() { stateDirty = true; }
setInterval(() => {
  if (!stateDirty) return;
  stateDirty = false;
  try { writeFileSync(STATE_FILE, JSON.stringify({ sessionId: state.sessionId, seq: state.seq })); } catch {}
}, 1000).unref();

// ---------- gateway token (refreshed by every /say) ----------
let gwToken = process.env.ANTHROPIC_API_KEY || '';
let queryStartedAt = 0;

// ---------- event stream ----------
const buffer = [];            // replay window for SSE reattach
const listeners = new Set();  // open SSE responses
let pendingDb = [];           // events awaiting persistence
let currentTurn = null;
let status = 'idle';
let currentTool = null;
let lastUserText = '';
let lastRewind = null;
let lastActivityAt = Date.now(); // any control request, SSE client, or emitted event

function emit(type, payload, ephemeral) {
  lastActivityAt = Date.now();
  const ev = { seq: ++state.seq, turn_id: currentTurn, type: type, payload: payload || {} };
  saveState();
  buffer.push(ev);
  if (buffer.length > 4000) buffer.splice(0, buffer.length - 4000);
  const line = 'data: ' + JSON.stringify(ev) + String.fromCharCode(10, 10);
  for (const res of listeners) { try { res.write(line); } catch {} }
  if (!ephemeral) {
    pendingDb.push(ev);
    if (pendingDb.length > 3000) pendingDb.splice(0, pendingDb.length - 3000);
  }
  return ev;
}

async function flushDb() {
  if (!pendingDb.length || !ORIGIN || !gwToken) return;
  const batch = pendingDb.splice(0, 60);
  try {
    const res = await fetch(ORIGIN + '/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + gwToken },
      body: JSON.stringify({ events: batch }),
    });
    if (!res.ok) pendingDb = batch.concat(pendingDb);
  } catch { pendingDb = batch.concat(pendingDb); }
}
setInterval(flushDb, 900).unref();

function setStatus(s, tool) {
  status = s;
  currentTool = tool || null;
  emit('status', { status: s, tool: currentTool }, true);
}

// ---------- payload trimming (events must stay small) ----------
function cap(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + ' …[truncated]' : s; }
function trimInput(name, input) {
  const i = input || {};
  const out = {};
  for (const k of Object.keys(i)) {
    const v = i[k];
    if (typeof v === 'string') {
      const lim = (k === 'old_string' || k === 'new_string' || k === 'content') ? 6000
        : (k === 'prompt' || k === 'description') ? 2000 : 600;
      out[k] = cap(v, lim);
    } else if (Array.isArray(v) && k === 'todos') { out[k] = v.slice(0, 30); }
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (v != null) out[k] = cap(JSON.stringify(v), 800);
  }
  return out;
}
function trimResult(content) {
  if (typeof content === 'string') return cap(content, 2500);
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const b of content) {
    if (b && b.type === 'text') parts.push(b.text || '');
    else if (b && b.type === 'image') parts.push('[image]');
  }
  return cap(parts.join(String.fromCharCode(10)), 2500);
}
function targetOf(b) {
  const i = b.input || {};
  return cap(i.file_path || i.path || i.pattern || i.command || i.description || i.url || '', 160);
}

// ---------- message queue + agent session ----------
const queue = [];   // { id, text, content }
let wakeup = null;
let liveQuery = null;
let inFlight = null;
let sawTurnActivity = false;
let pendingRestart = false;
let interrupting = false;
let turnCounter = 0;

function makeInput() {
  return (async function* () {
    while (true) {
      if (pendingRestart) { pendingRestart = false; return; }
      if (queue.length) {
        const m = queue.shift();
        currentTurn = m.id;
        inFlight = m;
        sawTurnActivity = false;
        lastUserText = m.text;
        emit('turn_start', { id: m.id }, true);
        setStatus('working');
        yield { type: 'user', message: { role: 'user', content: m.content }, parent_tool_use_id: null };
        continue;
      }
      await new Promise((r) => { wakeup = r; });
      wakeup = null;
    }
  })();
}

function agentOptions() {
  const plugins = (process.env.PHANTOM_PLUGINS || '').split(',').filter(Boolean)
    .map((n) => ({ type: 'local', path: PLUGIN_BASE + '/' + n }));
  const mainAppend = [
    'You are the Phantom — the resident design-build agent of this project. You build and refine one real static site: plain HTML + Tailwind v4 + light vanilla JS, Vite as dev server only. No React, no frameworks, no build steps. CLAUDE.md holds the brand kit and every site convention — honor it exactly.',
    'THE SUMMONS — while no apparition is claimed (the context note on each message tells you): a request for new site work means THREE parallel design explorations. Launch all three design-builder subagents in ONE message (three parallel Task calls): variant one (faithful to the brand kit; art direction: editorial restraint — generous whitespace, asymmetric grid, type-led hero, quiet motion), variant two (faithful; art direction: immersive boldness — full-bleed imagery, layered depth, oversized display type, confident accent color), variant three (UNBOUND — keeps only the brand name, real content, and HARD compliance rules; invents its own palette, typography, and art direction; daring and original). Each Task prompt must state: the variant name, its directory designs/<variant>/, its mode and art direction, and the invoker words verbatim.',
    'CRITICAL — how you run the summons: use ordinary BLOCKING Task calls and WAIT for all three to return their final reports in the SAME turn. Do NOT run them as background/async agents, do NOT use SendMessage, and do NOT end your turn or reply to the invoker while any apparition is still building. Your turn is over ONLY when you hold all three final reports.',
    'If an apparition errors or times out (a transient "API Error: operation timed out" is common and is NOT a real failure), simply launch that one variant again as a fresh blocking Task and wait for it — repeat until all three have genuinely completed. Never declare the forms done, and never say something like "I will return when they stand", while any design is unfinished — there is no later; if you stop, they stop.',
    'Before your turn ends, confirm each of designs/one, designs/two, designs/three has a real, complete index.html (not the starter placeholder). If any is still the placeholder, it is not done — relaunch it.',
    'While the summons is open, follow-up words from the invoker also go to all three (three parallel blocking Tasks again, each continuing its own design; same wait-for-all rule).',
    'AFTER A FORM IS CLAIMED: work directly yourself — read, edit, screenshot, verify. Use subagents only when parallel heavy lifting genuinely helps. Small refinements: edit directly and quickly.',
    'Verify your own work: run node shot.mjs /tmp/<name>.png desktop /designs/<variant>/ (also tablet or phone), then Read the PNG to actually see it. For behavior (menus, forms, motion) use the playwright MCP browser tools against http://localhost:5173. Fix what looks or behaves off before finishing.',
    'Use TodoWrite for any multi-step work so the invoker can watch your plan progress.',
    'Never run git — the chamber commits each turn itself. Never touch package.json, vite.config.js, node_modules, or files outside the site.',
    'Speak as the Phantom: spare, evocative, precise. Short replies. Never dump file contents or raw logs into chat.',
  ].join(String.fromCharCode(10));

  const builderPrompt = [
    'You are a Phantom design-builder. You build EXACTLY ONE design of a static site inside this Vite + Tailwind v4 project: plain HTML, modern CSS, light vanilla JS. No React, no frameworks, no build steps.',
    'FIRST read CLAUDE.md at the project root — the brand kit and all site conventions live there. Faithful variants honor the kit exactly; the unbound variant keeps only the brand name, real content, and HARD compliance rules, inventing everything else fresh.',
    'Your task prompt names your variant and directory designs/<variant>/. Edit ONLY inside that directory: index.html, styles.css, script.js (more pages allowed, linked relatively). NEVER touch other design directories, the root index.html, package.json, vite.config.js, or node_modules.',
    'Style with Tailwind utility classes; custom CSS (font-face, keyframes, bespoke effects) goes in styles.css BELOW the tailwindcss import line.',
    'Brand assets are served at /assets/<file>. Read public/assets/manifest.json to see what exists. Prefer real assets over placeholders; load brand fonts with font-face pointing at /assets/<file>.',
    'Build the page FIRST, completely, using existing assets and tasteful non-image treatments as stand-ins. Only THEN conjure new imagery — at most 3 images. ALWAYS wrap the generator in a timeout so a slow provider can never hang the build, and keep images web-sized (do NOT pass --image-size 2K; the default/1K is right): timeout 150 bash ' + PLUGIN_BASE + '/claude-image-generation/scripts/gemini.sh --mode generate --prompt "rich specific prompt" --aspect-ratio 16:9 --output public/assets/<fresh-slug>.png (or xai.sh; edit with --mode edit --input-image). If a generation times out or errors, skip that image and move on with a tasteful non-image treatment — never retry it more than once. Write outputs ONLY into public/assets/ under a fresh slug and reference them as /assets/<slug>.png.',
    'For design decisions, first invoke the ui-ux-pro-max skill and apply its guidance, always subordinate to CLAUDE.md rules.',
    'MOTION is where these designs win. For anything beyond a trivial transition — scroll-driven reveals, pinned/scrubbed sections, timelines, split-text headline reveals — use GSAP (already available, all plugins free): invoke the gsap-skills (gsap-core, gsap-scrolltrigger, gsap-timeline, gsap-plugins, gsap-performance) for correct current patterns. Load GSAP + ScrollTrigger + SplitText from a CDN script tag. Prefer native CSS scroll-driven animations (animation-timeline: view()) for simple reveals to stay light; reach for GSAP when the motion is the point. Respect prefers-reduced-motion.',
    'CURRENT APIs: this is Tailwind v4 (CSS-first) — a single @import "tailwindcss"; line, theme tokens via @theme, NO tailwind.config.js, NO @tailwind base/components/utilities. When unsure of ANY current library API (Tailwind v4, GSAP, Three.js, Lenis), query the Context7 MCP (resolve-library-id then get-library-docs) before writing — do not guess from memory, which skews to outdated versions. GitMCP is a keyless fallback for any GitHub repo docs.',
    'ICONS — this is a hard rule, applies EVERY time without being asked: any glyph at all (rating stars, arrows, chevrons, social logos, feature bullets, checkmarks, UI affordances) comes from the better-icons MCP. Search it for the token (e.g. "star" -> lucide:star, "arrow" -> lucide:arrow-right), then inline the returned SVG or use <iconify-icon icon="set:name">. NEVER hand-write SVG path data, and NEVER use unicode/emoji characters (★ ☆ → ✓) as iconography.',
    'SEE your work before finishing: node shot.mjs /tmp/<variant>.png desktop /designs/<variant>/ (also tablet + phone), then Read the PNG. For motion/interaction, drive the playwright MCP browser against http://localhost:5173 to verify it actually behaves. Critique honestly — layout, spacing, hierarchy, contrast, overflow, broken elements, motion — fix and re-shoot until it genuinely looks good.',
    'Work decisively. When done, report ONE short paragraph: art direction, sections built, standout details. The main Phantom reads it; the invoker never sees it directly.',
  ].join(String.fromCharCode(10));

  // skills the enabled plugins expose (computed server-side, passed via env);
  // fall back to the two originals if the env is missing (older app version)
  const skills = (process.env.PHANTOM_SKILLS || 'ui-ux-pro-max:ui-ux-pro-max,claude-image-generation:image-generation')
    .split(',').map((s) => s.trim()).filter(Boolean);

  // MCP servers: Playwright (browser), Context7 (live version-correct docs for
  // any library — essential for Tailwind v4, which ships no skill), better-icons
  // (Iconify token + SVG search), GitMCP (keyless docs fallback for any repo).
  const ctx7Key = process.env.CONTEXT7_API_KEY || '';
  const mcpServers = {
    playwright: {
      type: 'stdio',
      command: 'node',
      args: [TOOLS + '/node_modules/@playwright/mcp/cli.js', '--headless', '--isolated'],
    },
    context7: Object.assign(
      { type: 'http', url: 'https://mcp.context7.com/mcp' },
      ctx7Key ? { headers: { CONTEXT7_API_KEY: ctx7Key } } : {},
    ),
    gitmcp: { type: 'http', url: 'https://gitmcp.io/docs' },
    'better-icons': { type: 'stdio', command: 'npx', args: ['-y', 'better-icons'] },
  };

  return {
    model: MODEL,
    cwd: process.cwd(),
    systemPrompt: { type: 'preset', preset: 'claude_code', append: mainAppend },
    permissionMode: 'bypassPermissions',
    maxTurns: 150,
    includePartialMessages: true,
    forwardSubagentText: true,
    settingSources: ['project'],
    env: Object.assign({}, process.env, { ANTHROPIC_API_KEY: gwToken, IS_SANDBOX: '1' }),
    plugins: plugins,
    skills: skills,
    mcpServers: mcpServers,
    agents: {
      'design-builder': {
        description: 'Builds one apparition (design variant) of the site in its own designs/<variant>/ directory.',
        prompt: builderPrompt,
        skills: skills,
        // AgentDefinition.mcpServers is an array of specs; wrap the record so the
        // builder (which writes the code) gets the same docs/icon/browser servers
        mcpServers: [mcpServers],
        // pinned reminder so the toolset is treated as default equipment, not
        // something to use only when asked (agents skip tools they think they
        // don't need — this keeps icon/motion/docs lookups habitual)
        criticalSystemReminder_EXPERIMENTAL:
          'Your tools are standard equipment, used by default without being asked: better-icons for EVERY icon or glyph (stars, arrows, social, checkmarks — never hand-draw SVG or use unicode/emoji); the gsap-skills + GSAP for any motion that is a feature (hero, scrub, pinned, staggered choreography), native CSS for light reveals; Context7 to confirm the CURRENT API of Tailwind v4 / GSAP / any library before writing (do not trust memory — it skews old); the playwright browser to actually verify interaction and motion, not just a screenshot.',
        model: 'inherit',
        permissionMode: 'bypassPermissions',
      },
    },
  };
}

// live streaming text per lane (parent_tool_use_id or '' = main)
const liveText = new Map();
let deltaTimer = null;
function pushDelta(parent, text) {
  const key = parent || '';
  liveText.set(key, (liveText.get(key) || '') + text);
  if (deltaTimer) return;
  deltaTimer = setTimeout(() => {
    deltaTimer = null;
    for (const [k, v] of liveText) emit('delta', { parent: k || null, text: v }, true);
  }, 180);
}

function registerAssets() {
  // upload any imagery the turn conjured into the vault so it shows in the
  // panel and survives the next build's prune. Runs async (spawn, not execSync)
  // so a slow upload never blocks the daemon's SSE / interrupt loop; emits an
  // 'assets' event when done so the UI refreshes the vault.
  try {
    const child = spawn('node', ['register-assets.mjs'], {
      env: Object.assign({}, process.env, { ANTHROPIC_API_KEY: gwToken }),
      stdio: 'ignore',
    });
    child.on('close', () => emit('assets', {}, true));
    child.on('error', () => {});
  } catch {}
}

function commitTurn() {
  try {
    execSync('git add -A && (git diff --cached --quiet || git commit -q -m ' + JSON.stringify('turn: ' + lastUserText.slice(0, 60)) + ')', { timeout: 30000 });
    const sha = execSync('git rev-parse --short HEAD', { timeout: 5000 }).toString().trim();
    emit('checkpoint', { sha: sha });
  } catch {}
  registerAssets();
}

function handle(m) {
  if (m.session_id && m.session_id !== state.sessionId) { state.sessionId = m.session_id; saveState(); }
  if (m.type === 'system' && m.subtype === 'init') {
    emit('init', { session: m.session_id, model: m.model }, true);
    return;
  }
  if (m.type === 'stream_event') {
    const e = m.event || {};
    if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta' && e.delta.text) {
      pushDelta(m.parent_tool_use_id, e.delta.text);
    }
    return;
  }
  if (m.type === 'assistant' && m.message) {
    for (const b of m.message.content || []) {
      if (b.type === 'text' && b.text) {
        liveText.delete(m.parent_tool_use_id || '');
        emit('text', { text: b.text, parent: m.parent_tool_use_id || null });
      } else if (b.type === 'thinking' && b.thinking) {
        emit('thinking', { preview: cap(b.thinking, 280), parent: m.parent_tool_use_id || null });
      } else if (b.type === 'tool_use') {
        sawTurnActivity = true;
        if (b.name === 'TodoWrite') {
          emit('todo', { todos: ((b.input || {}).todos || []).slice(0, 30), parent: m.parent_tool_use_id || null });
        } else {
          emit('tool_use', { id: b.id, name: b.name, input: trimInput(b.name, b.input), parent: m.parent_tool_use_id || null });
        }
        setStatus('working', { name: b.name, target: targetOf(b) });
      }
    }
    return;
  }
  if (m.type === 'user' && m.message) {
    const content = m.message.content;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b && b.type === 'tool_result') {
          emit('tool_result', {
            id: b.tool_use_id,
            content: trimResult(b.content),
            is_error: !!b.is_error,
            parent: m.parent_tool_use_id || null,
          });
        }
      }
    }
    return;
  }
  if (m.type === 'result') {
    inFlight = null;
    liveText.clear();
    const usage = m.usage || {};
    emit('result', {
      subtype: m.subtype,
      duration_ms: m.duration_ms,
      turns: m.num_turns,
      cost_usd: m.total_cost_usd,
      tokens: { in: usage.input_tokens || 0, out: usage.output_tokens || 0 },
    });
    commitTurn();
    if (!queue.length) setStatus('idle');
    return;
  }
}

const transient = (e) => /connection closed|overloaded|rate limit|too many requests|429|500|502|503|504|529|ECONNRESET|ETIMEDOUT|socket hang up|terminated|fetch failed|stalled|timed? out|timeout|authentication|invalid session token/i.test(String((e && e.message) || e));

async function runForever() {
  let attempt = 0;
  while (true) {
    try {
      const opts = agentOptions();
      if (state.sessionId) opts.resume = state.sessionId;
      queryStartedAt = Date.now();
      liveQuery = query({ prompt: makeInput(), options: opts });
      for await (const m of liveQuery) { attempt = 0; handle(m); }
      // input generator returned (planned restart) — loop with fresh env
      liveQuery = null;
      if (queue.length || pendingRestart) continue;
      if (status !== 'idle') setStatus('idle');
    } catch (e) {
      liveQuery = null;
      const msg = String((e && e.message) || e);
      // an intentional interrupt tears the stream down (killed workers) — that
      // is not a failure to retry; drop the turn and wait for the next word
      if (interrupting) {
        interrupting = false;
        inFlight = null;
        attempt = 0;
        if (status !== 'idle' && !queue.length) setStatus('idle');
        continue;
      }
      if (inFlight && !sawTurnActivity) queue.unshift(inFlight);
      inFlight = null;
      if (transient(msg) && attempt < 6) {
        attempt++;
        emit('notice', { text: 'The thread slipped — reweaving (' + attempt + ')…' }, true);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      emit('error', { message: cap(msg, 500) });
      setStatus('idle');
      attempt = 0;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
runForever();

// ---------- vite watchdog ----------
// A heavy parallel build (3 subagents + image-gen) can OOM/crash vite, which
// silently breaks the agents' screenshot verification (shot.mjs curls :5173)
// and the live preview. The daemon is the always-on process, so it keeps vite
// alive: probe the port (non-blocking http, never a blocking curl); if it's
// down two checks running, revive it detached. Two-strike to ignore a brief
// HMR reload. Only revives when actually down — never disrupts a healthy vite.
let viteDownStreak = 0;
function probeVite(cb) {
  const req = httpGet({ host: '127.0.0.1', port: 5173, path: '/', timeout: 3000 }, (res) => {
    res.resume();
    cb(res.statusCode > 0);
  });
  req.on('error', () => cb(false));
  req.on('timeout', () => { req.destroy(); cb(false); });
}
setInterval(() => {
  probeVite((up) => {
    if (up) { viteDownStreak = 0; return; }
    if (++viteDownStreak < 2) return;
    viteDownStreak = 0;
    try {
      spawn('sh', ['-c', "pkill -9 -f '[v]ite' 2>/dev/null; sleep 1; nohup npm run dev >/tmp/vite.log 2>&1 &"], {
        stdio: 'ignore',
        detached: true,
      }).unref();
      emit('notice', { text: 'The chamber flickered — reviving the preview.' }, true);
    } catch {}
  });
}, 20000).unref();

// ---------- idle hibernation ----------
// A VM left running forever holds one of the workspace's few concurrent-VM
// slots; enough dormant chambers and NOTHING can boot. When nobody is attached,
// no turn is running, and nothing is queued for long enough, flush events and
// ask the app to shut this VM down (files persist; the next open resumes it).
const IDLE_MS = Number(process.env.PHANTOM_IDLE_MS || 30 * 60 * 1000);
let hibernateAskedAt = 0;
setInterval(async () => {
  if (!ORIGIN || !gwToken) return;
  if (listeners.size > 0 || status !== 'idle' || queue.length > 0) return;
  if (Date.now() - lastActivityAt < IDLE_MS) return;
  if (Date.now() - hibernateAskedAt < 5 * 60 * 1000) return; // a failed ask retries later
  hibernateAskedAt = Date.now();
  try {
    await flushDb();
    await fetch(ORIGIN + '/api/hibernate', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + gwToken },
    });
    // if the shutdown lands, the VM (and this process) stops here
  } catch {}
}, 60000).unref();

// ---------- control server ----------
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,x-phantom-auth');
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 6e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
  });
}
function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = createServer(async (req, res) => {
  cors(res);
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (url.pathname === '/health') return json(res, 200, { ok: true, v: VERSION, status: status });

  const auth = req.headers['x-phantom-auth'] || url.searchParams.get('auth') || '';
  if (!SECRET || auth !== SECRET) return json(res, 401, { error: 'unauthorized' });
  lastActivityAt = Date.now();

  if (url.pathname === '/state') {
    return json(res, 200, {
      ok: true, status: status, seq: state.seq, session: state.sessionId,
      tool: currentTool, queue: queue.map((m) => ({ id: m.id, text: cap(m.text, 120) })),
    });
  }

  if (url.pathname === '/say' && req.method === 'POST') {
    const body = await readBody(req);
    const text = String(body.text || '').trim();
    if (!text) return json(res, 400, { error: 'empty' });
    if (body.token) gwToken = body.token;
    // stale CLI env self-heal: restart the session (resume) before a turn
    // whose spawn-time token would be expired
    if (liveQuery && status === 'idle' && Date.now() - queryStartedAt > 12 * 3600 * 1000) {
      pendingRestart = true;
      if (wakeup) wakeup();
      await new Promise((r) => setTimeout(r, 300));
    }
    const id = 't' + Date.now().toString(36) + '-' + (++turnCounter);
    const noteParts = [];
    if (body.context) noteParts.push(String(body.context));
    if (lastRewind) { noteParts.push('The invoker rewound the site files to checkpoint ' + lastRewind + ' — re-read files before assuming their state.'); lastRewind = null; }
    const composed = noteParts.length
      ? text + String.fromCharCode(10, 10) + '<phantom-context>' + noteParts.join(' ') + '</phantom-context>'
      : text;
    const content = [];
    if (Array.isArray(body.images)) {
      for (const im of body.images.slice(0, 4)) {
        if (im && im.data && im.media_type) content.push({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } });
      }
    }
    content.push({ type: 'text', text: composed });
    emit('user', { text: text, images: content.length - 1, queued: status === 'working' });
    queue.push({ id: id, text: text, content: content });
    if (wakeup) wakeup();
    return json(res, 200, { ok: true, id: id, seq: state.seq });
  }

  if (url.pathname === '/interrupt' && req.method === 'POST') {
    queue.length = 0;
    interrupting = true;
    try { if (liveQuery) await liveQuery.interrupt(); } catch {}
    // hard stop: the main interrupt may not reach subagent CLI workers already
    // dispatched for parallel Tasks — kill them so work actually ceases. The
    // [c] bracket trick keeps this pkill from matching the daemon's own node.
    try { execSync("pkill -f '[c]laude' 2>/dev/null; pkill -f 'agent-sdk' 2>/dev/null; true", { timeout: 5000 }); } catch {}
    emit('interrupted', {});
    setStatus('idle');
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/checkpoints') {
    try {
      const out = execSync("git log -25 --format='%h|%ct|%s'", { timeout: 5000 }).toString().trim();
      const rows = out ? out.split(String.fromCharCode(10)).map((l) => {
        const p = l.split('|');
        return { sha: p[0], at: Number(p[1]) * 1000, label: p.slice(2).join('|') };
      }) : [];
      return json(res, 200, { ok: true, checkpoints: rows });
    } catch { return json(res, 200, { ok: true, checkpoints: [] }); }
  }

  if (url.pathname === '/rewind' && req.method === 'POST') {
    if (status === 'working') return json(res, 409, { error: 'busy' });
    const body = await readBody(req);
    const sha = String(body.sha || '').replace(/[^a-f0-9]/gi, '').slice(0, 40);
    if (!sha) return json(res, 400, { error: 'bad sha' });
    try {
      execSync('git reset --hard ' + sha, { timeout: 15000 });
      // a hard reset rewrites files under the running vite, which can wedge the
      // dev server (process alive, port dead → 502). Nudge it back, detached so
      // the kill can't reach this handler.
      try {
        spawn('sh', ['-c', "pkill -9 -f '[v]ite' 2>/dev/null; sleep 1; nohup npm run dev >/tmp/vite.log 2>&1 &"], {
          stdio: 'ignore',
          detached: true,
        }).unref();
      } catch {}
      lastRewind = sha;
      emit('rewind', { sha: sha });
      return json(res, 200, { ok: true });
    } catch (e) { return json(res, 500, { error: cap(String(e && e.message || e), 200) }); }
  }

  if (url.pathname === '/events') {
    const after = Number(url.searchParams.get('after') || 0);
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    res.write(': attached' + String.fromCharCode(10, 10));
    for (const ev of buffer) {
      if (ev.seq > after) res.write('data: ' + JSON.stringify(ev) + String.fromCharCode(10, 10));
    }
    res.write('data: ' + JSON.stringify({ seq: state.seq, type: 'status', turn_id: currentTurn, payload: { status: status, tool: currentTool } }) + String.fromCharCode(10, 10));
    listeners.add(res);
    const ping = setInterval(() => { try { res.write(': ping' + String.fromCharCode(10, 10)); } catch {} }, 15000);
    req.on('close', () => { clearInterval(ping); listeners.delete(res); lastActivityAt = Date.now(); });
    return;
  }

  json(res, 404, { error: 'not found' });
});
server.listen(PORT, () => console.log('phantom-daemon v' + VERSION + ' listening on ' + PORT));
`;
