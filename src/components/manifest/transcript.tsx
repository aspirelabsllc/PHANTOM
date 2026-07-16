"use client";

import { Fragment, useMemo, useState } from "react";
import type { PhantomEvent } from "@/lib/projects";
import { ReplyMd } from "@/components/reply-md";

// Renders the daemon's event stream the way Claude Code renders a session:
// user words, streaming replies, tool cards (with diffs and results), todo
// checklists, nested subagent lanes, and turn footers with checkpoints.

type ToolPayload = {
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  parent?: string | null;
};

type Item =
  | { kind: "user"; text: string; images: number; queued: boolean }
  | { kind: "text"; text: string }
  | { kind: "thinking"; preview: string }
  | { kind: "todo"; todos: { content?: string; status?: string; activeForm?: string }[] }
  | ToolItem
  | { kind: "result"; subtype?: string; duration_ms?: number; turns?: number; cost_usd?: number; tokens?: { in: number; out: number }; sha?: string }
  | { kind: "error"; message: string }
  | { kind: "interrupted" }
  | { kind: "rewind"; sha: string };

type ToolItem = {
  kind: "tool";
  id: string;
  name: string;
  input: Record<string, unknown>;
  result: { content?: string; is_error?: boolean } | null;
  children: Item[];
};

const TOOL_VERB: Record<string, string> = {
  Read: "READ",
  Write: "WRITE",
  Edit: "EDIT",
  Bash: "RUN",
  Glob: "SCAN",
  Grep: "SCAN",
  Task: "SUMMON",
  Agent: "SUMMON",
  WebSearch: "SEEK",
  WebFetch: "FETCH",
  Skill: "SKILL",
};

// The subagent-spawning tool is named "Task" on some CLIs, "Agent" on others.
function isSummon(name: string): boolean {
  return name === "Task" || name === "Agent";
}

function verbOf(name: string): string {
  if (name.startsWith("mcp__playwright")) return "BROWSE";
  if (name.startsWith("mcp__")) return "MCP";
  return TOOL_VERB[name] ?? name.toUpperCase().slice(0, 8);
}

function targetOf(t: ToolItem): string {
  const i = t.input;
  const raw =
    (i.file_path as string) ??
    (i.path as string) ??
    (i.pattern as string) ??
    (i.command as string) ??
    (i.description as string) ??
    (i.url as string) ??
    (i.skill as string) ??
    "";
  const s = String(raw);
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
}

// Build the item tree from the flat event stream. Tool results attach to
// their tool; anything with a parent nests under that (Task) tool's lane.
function buildItems(events: PhantomEvent[]): Item[] {
  const items: Item[] = [];
  const tools = new Map<string, ToolItem>();
  const todoOf = new Map<string, Item & { kind: "todo" }>(); // lane → live checklist

  const laneOf = (parent: unknown): Item[] => {
    if (typeof parent === "string" && tools.has(parent)) return tools.get(parent)!.children;
    return items;
  };

  for (const ev of events) {
    const p = (ev.payload ?? {}) as Record<string, unknown>;
    switch (ev.type) {
      case "user":
        items.push({
          kind: "user",
          text: String(p.text ?? ""),
          images: Number(p.images ?? 0),
          queued: Boolean(p.queued),
        });
        break;
      case "text":
        laneOf(p.parent).push({ kind: "text", text: String(p.text ?? "") });
        break;
      case "thinking":
        laneOf(p.parent).push({ kind: "thinking", preview: String(p.preview ?? "") });
        break;
      case "todo": {
        const laneKey = typeof p.parent === "string" ? p.parent : "";
        const todos = (p.todos ?? []) as { content?: string; status?: string }[];
        const existing = todoOf.get(laneKey);
        if (existing) existing.todos = todos;
        else {
          const item = { kind: "todo" as const, todos };
          todoOf.set(laneKey, item);
          laneOf(p.parent).push(item);
        }
        break;
      }
      case "tool_use": {
        const t: ToolItem = {
          kind: "tool",
          id: String(p.id ?? ""),
          name: String(p.name ?? "?"),
          input: (p.input ?? {}) as Record<string, unknown>,
          result: null,
          children: [],
        };
        if (t.id) tools.set(t.id, t);
        laneOf(p.parent).push(t);
        break;
      }
      case "tool_result": {
        const t = tools.get(String(p.id ?? ""));
        if (t) t.result = { content: String(p.content ?? ""), is_error: Boolean(p.is_error) };
        break;
      }
      case "result":
        todoOf.clear();
        items.push({
          kind: "result",
          subtype: p.subtype as string,
          duration_ms: p.duration_ms as number,
          turns: p.turns as number,
          cost_usd: p.cost_usd as number,
          tokens: p.tokens as { in: number; out: number },
        });
        break;
      case "checkpoint": {
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i];
          if (it.kind === "result") {
            it.sha = String(p.sha ?? "");
            break;
          }
          if (it.kind === "user") break;
        }
        break;
      }
      case "error":
        items.push({ kind: "error", message: String(p.message ?? "") });
        break;
      case "interrupted":
        todoOf.clear();
        items.push({ kind: "interrupted" });
        break;
      case "rewind":
        items.push({ kind: "rewind", sha: String(p.sha ?? "") });
        break;
    }
  }
  return items;
}

function Duration({ ms }: { ms?: number }) {
  if (!ms || ms <= 0) return null;
  const s = Math.round(ms / 1000);
  return <span>{s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`}</span>;
}

function ToolDetail({ t }: { t: ToolItem }) {
  const i = t.input;
  const isEdit = t.name === "Edit" && Boolean(i.old_string || i.new_string);
  const isWrite = t.name === "Write" && Boolean(i.content);
  const isBash = t.name === "Bash" && Boolean(i.command);
  return (
    <div className="tool-detail">
      {isEdit && (
        <div className="tool-diff">
          {!!i.old_string && <pre className="diff-del">{String(i.old_string)}</pre>}
          {!!i.new_string && <pre className="diff-add">{String(i.new_string)}</pre>}
        </div>
      )}
      {isWrite && <pre className="diff-add">{String(i.content)}</pre>}
      {isBash && <pre className="tool-cmd">$ {String(i.command)}</pre>}
      {!isEdit && !isWrite && !isBash && (
        <pre className="tool-cmd">{JSON.stringify(i, null, 2).slice(0, 2000)}</pre>
      )}
      {t.result?.content && (
        <pre className={`tool-out${t.result.is_error ? " err" : ""}`}>{t.result.content}</pre>
      )}
    </div>
  );
}

function TaskCard({ t, deltas }: { t: ToolItem; deltas: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const done = !!t.result;
  const failed = done && t.result?.is_error;
  const label =
    (t.input.description as string) ??
    (t.input.subagent_type as string) ??
    "design-builder";
  const toolCount = t.children.filter((c) => c.kind === "tool").length;
  const last = t.children[t.children.length - 1];
  const ticker = !done
    ? deltas[t.id]
      ? `${deltas[t.id]!.slice(-120)}`
      : last?.kind === "tool"
        ? `${verbOf((last as ToolItem).name)} ${targetOf(last as ToolItem)}`
        : last?.kind === "text"
          ? last.text.slice(0, 120)
          : "condensing…"
    : null;

  return (
    <div className={`task-card${done ? (failed ? " failed" : " done") : " running"}`}>
      <button className="task-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`task-dot${done ? (failed ? " err" : " ok") : " live"}`} />
        <span className="task-label">{label}</span>
        <span className="task-meta">
          {toolCount > 0 && `${toolCount} moves`}
          {done ? (failed ? " · FALTERED" : " · SETTLED") : " · AT WORK"}
        </span>
        <span className="task-chev">{open ? "−" : "+"}</span>
      </button>
      {!open && ticker && <div className="task-ticker">{ticker}</div>}
      {open && (
        <div className="task-body">
          <ItemList items={t.children} deltas={deltas} laneKey={t.id} nested />
          {done && t.result?.content && (
            <div className="task-report">
              <ReplyMd>{t.result.content}</ReplyMd>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToolRow({ t }: { t: ToolItem }) {
  const [open, setOpen] = useState(false);
  const verb = verbOf(t.name);
  return (
    <>
      <button
        className={`log-row clickable${!t.result ? " running" : t.result.is_error ? " errored" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={`verb ${verb.toLowerCase()}`}>{verb}</span>
        <span className="target">{targetOf(t)}</span>
        <span className="row-chev">{open ? "−" : "+"}</span>
      </button>
      {open && <ToolDetail t={t} />}
    </>
  );
}

function TodoList({ todos }: { todos: { content?: string; status?: string; activeForm?: string }[] }) {
  if (!todos.length) return null;
  return (
    <div className="todo-card" role="status" aria-label="The Phantom's plan">
      {todos.map((td, i) => (
        <div className={`todo-row ${td.status ?? "pending"}`} key={i}>
          <span className="todo-mark">
            {td.status === "completed" ? "✦" : td.status === "in_progress" ? "◌" : "·"}
          </span>
          <span className="todo-text">
            {td.status === "in_progress" ? (td.activeForm ?? td.content) : td.content}
          </span>
        </div>
      ))}
    </div>
  );
}

function ItemList({
  items,
  deltas,
  laneKey,
  nested = false,
  onRewind,
}: {
  items: Item[];
  deltas: Record<string, string>;
  laneKey: string;
  nested?: boolean;
  onRewind?: (sha: string) => void;
}) {
  // group consecutive plain tools into one log block, Claude Code style
  const blocks: (Item | { kind: "tools"; tools: ToolItem[] })[] = [];
  for (const it of items) {
    if (it.kind === "tool" && !isSummon(it.name)) {
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "tools") last.tools.push(it);
      else blocks.push({ kind: "tools", tools: [it] });
    } else blocks.push(it);
  }
  const live = deltas[laneKey];

  return (
    <>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "user":
            return (
              <div className="msg user" key={i}>
                <span className="who">You{b.queued ? " · QUEUED" : ""}</span>
                <div className="bubble">
                  <p>
                    {b.text}
                    {b.images > 0 && <span className="img-note"> · {b.images} image(s)</span>}
                  </p>
                </div>
              </div>
            );
          case "tools":
            return (
              <div className="lab-log" role="log" key={i}>
                {b.tools.map((t) => (
                  <ToolRow t={t} key={t.id} />
                ))}
              </div>
            );
          case "tool": // Task
            return <TaskCard t={b} deltas={deltas} key={(b as ToolItem).id || i} />;
          case "text":
            return (
              <div className={`msg phantom${nested ? " nested" : ""}`} key={i}>
                {!nested && <span className="who">Phantom</span>}
                <ReplyMd>{b.text}</ReplyMd>
              </div>
            );
          case "thinking":
            return (
              <div className="think-row" key={i} title={b.preview}>
                <span className="think-dot" /> pondering…
              </div>
            );
          case "todo":
            return <TodoList todos={b.todos} key={i} />;
          case "result":
            return (
              <div className="turn-foot" key={i}>
                <span className="tf-mark">✦</span>
                {b.subtype === "success" ? "the turn settled" : (b.subtype ?? "settled")}
                {" · "}
                <Duration ms={b.duration_ms} />
                {typeof b.cost_usd === "number" && b.cost_usd > 0 && (
                  <> · ${b.cost_usd.toFixed(2)}</>
                )}
                {b.sha && onRewind && (
                  <button
                    className="tf-rewind"
                    title={`Rewind the site files to checkpoint ${b.sha}`}
                    onClick={() => onRewind(b.sha!)}
                  >
                    ⟲ {b.sha}
                  </button>
                )}
              </div>
            );
          case "error":
            return (
              <div className="msg phantom" key={i}>
                <span className="who">Phantom</span>
                <p className="voice-line">The build faltered — {b.message}</p>
              </div>
            );
          case "interrupted":
            return (
              <div className="sys-row" key={i}>
                YOU STAYED THE PHANTOM&apos;S HAND
              </div>
            );
          case "rewind":
            return (
              <div className="sys-row" key={i}>
                THE SITE REWOUND TO {b.sha.toUpperCase()}
              </div>
            );
        }
      })}
      {live && (
        <div className={`msg phantom${nested ? " nested" : ""}`}>
          {!nested && <span className="who">Phantom</span>}
          <ReplyMd>{live}</ReplyMd>
        </div>
      )}
    </>
  );
}

export function Transcript({
  events,
  deltas,
  onRewind,
}: {
  events: PhantomEvent[];
  deltas: Record<string, string>;
  onRewind?: (sha: string) => void;
}) {
  const items = useMemo(() => buildItems(events), [events]);
  return <ItemList items={items} deltas={deltas} laneKey="" onRewind={onRewind} />;
}
