# PHANTOM

> Every site already exists, perfect and waiting. We only make it visible.

An AI brand-ingestion + site-manifestation app. The **Phantom** reads what remains
of a brand — reports, marks, letterforms — and draws out its true form: colors,
type, voice, logo rules, compliance. That brand record then initializes the
Manifest, where the real site is built.

## Stack

- **Next.js 16** (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4
- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) — the AI backbone. One
  "Phantom" agent with custom in-process tools drives extraction and refinement.
- **Supabase** — auth (email/password), Postgres (`phantom_projects`), private
  Storage bucket for offerings.

## The Invocation (ingestion)

- **Extract** — drop brand documents; the agent reads them and draws a structured
  brand kit (streamed live: READ / EXTRACT / WRITE, nodes light as categories form).
- **Refine** — talk to the Phantom ("warm the voice", "drop the third palette");
  it edits the brand and tells you what changed.
- **Edit** — inline popover editing of every field (tokens, faces, rules).
- **Re-extract** — add more offerings; a non-destructive merge folds them in while
  preserving your edits. Delete offerings too.
- **Handoff** — `GET /api/projects/[id]/assets` returns the brand + classified,
  signed-URL assets — the contract the Manifest sandbox initializes from.

## Develop

```bash
pnpm install
cp .env.example .env.local   # fill in Supabase + Anthropic keys
node scripts/migrate.mjs     # create the table + storage bucket
pnpm dev
```

Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SECRET_KEY`, `SUPABASE_DATABASE_URL`, `ANTHROPIC_API_KEY` (server-only).
