"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PhantomEvent } from "@/lib/projects";

// The browser side of the Phantom daemon: attaches straight to the VM's SSE
// (the app server is never in the streaming path), merges the durable history
// with the live tail, and exposes say / stop / rewind controls.

export type DaemonTool = { name?: string; target?: string } | null;
export type DaemonState = {
  events: PhantomEvent[];
  deltas: Record<string, string>; // lane (parent tool id or "") → streaming text
  status: "connecting" | "idle" | "working" | "offline";
  tool: DaemonTool;
  queue: { id: string; text: string }[];
  assetsSignal: number; // bumps when the daemon finishes registering imagery
  say: (text: string, images?: { media_type: string; data: string }[]) => Promise<void>;
  stop: () => Promise<void>;
  rewind: (sha: string) => Promise<boolean>;
  saying: boolean;
};

type DaemonRef = { url: string; auth: string };

function daemonEndpoint(d: DaemonRef, path: string, params?: Record<string, string>): string {
  const u = new URL(d.url);
  u.pathname = path;
  u.searchParams.set("auth", d.auth);
  for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

export function useDaemon(projectId: string, initialEvents: PhantomEvent[], enabled: boolean): DaemonState {
  const [events, setEvents] = useState<PhantomEvent[]>(initialEvents);
  const [deltas, setDeltas] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<DaemonState["status"]>("connecting");
  const [tool, setTool] = useState<DaemonTool>(null);
  const [queue, setQueue] = useState<{ id: string; text: string }[]>([]);
  const [saying, setSaying] = useState(false);
  const [assetsSignal, setAssetsSignal] = useState(0);

  const daemonRef = useRef<DaemonRef | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const lastSeqRef = useRef<number>(initialEvents.reduce((m, e) => Math.max(m, e.seq), 0));
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadRef = useRef(false);

  const merge = useCallback((ev: PhantomEvent) => {
    if (ev.seq <= 0) return;
    setEvents((prev) => {
      if (prev.length && prev[prev.length - 1].seq < ev.seq) return [...prev, ev];
      if (prev.some((p) => p.seq === ev.seq)) return prev;
      return [...prev, ev].sort((a, b) => a.seq - b.seq);
    });
    lastSeqRef.current = Math.max(lastSeqRef.current, ev.seq);
  }, []);

  const handleEvent = useCallback(
    (ev: PhantomEvent) => {
      const p = (ev.payload ?? {}) as Record<string, unknown>;
      switch (ev.type) {
        case "status": {
          const s = p.status as string;
          setStatus(s === "working" ? "working" : "idle");
          setTool((p.tool as DaemonTool) ?? null);
          if (s !== "working") setDeltas({});
          return;
        }
        case "delta": {
          const lane = (p.parent as string | null) ?? "";
          setDeltas((d) => ({ ...d, [lane]: String(p.text ?? "") }));
          return;
        }
        case "turn_start":
          setDeltas({});
          setQueue((q) => q.slice(1));
          return;
        case "assets":
          setAssetsSignal((n) => n + 1);
          return;
        case "init":
        case "notice":
          return; // ephemeral chrome, not transcript
        case "text": {
          const lane = (p.parent as string | null) ?? "";
          setDeltas((d) => {
            if (!(lane in d)) return d;
            const next = { ...d };
            delete next[lane];
            return next;
          });
          merge(ev);
          return;
        }
        default:
          merge(ev);
      }
    },
    [merge],
  );

  const attach = useCallback(async () => {
    if (deadRef.current) return;
    try {
      if (!daemonRef.current) {
        const res = await fetch(`/api/projects/${projectId}/daemon`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "attach failed");
        daemonRef.current = { url: data.url as string, auth: data.auth as string };
      }
      const d = daemonRef.current;
      const es = new EventSource(
        daemonEndpoint(d, "/events", { after: String(lastSeqRef.current) }),
      );
      esRef.current = es;
      es.onopen = () => setStatus((s) => (s === "connecting" || s === "offline" ? "idle" : s));
      es.onmessage = (e) => {
        try {
          handleEvent(JSON.parse(e.data) as PhantomEvent);
        } catch {
          // tolerate malformed frames
        }
      };
      es.onerror = () => {
        es.close();
        if (esRef.current === es) esRef.current = null;
        setStatus("offline");
        if (!deadRef.current && !retryRef.current) {
          retryRef.current = setTimeout(() => {
            retryRef.current = null;
            attach();
          }, 4000);
        }
      };
    } catch {
      setStatus("offline");
      if (!deadRef.current && !retryRef.current) {
        retryRef.current = setTimeout(() => {
          retryRef.current = null;
          attach();
        }, 6000);
      }
    }
  }, [projectId, handleEvent]);

  useEffect(() => {
    if (!enabled) return;
    deadRef.current = false;
    attach();
    return () => {
      deadRef.current = true;
      esRef.current?.close();
      if (retryRef.current) clearTimeout(retryRef.current);
      retryRef.current = null;
    };
  }, [attach, enabled]);

  const say = useCallback(
    async (text: string, images?: { media_type: string; data: string }[]) => {
      setSaying(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/say`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, images }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "the word was lost");
        if (data.daemon?.url) {
          const fresh = { url: data.daemon.url as string, auth: data.daemon.auth as string };
          const moved = !daemonRef.current || daemonRef.current.url !== fresh.url;
          daemonRef.current = fresh;
          if (moved || !esRef.current) {
            esRef.current?.close();
            esRef.current = null;
            attach();
          }
        }
        setStatus("working");
      } finally {
        setSaying(false);
      }
    },
    [projectId, attach],
  );

  const stop = useCallback(async () => {
    const d = daemonRef.current;
    if (!d) return;
    await fetch(daemonEndpoint(d, "/interrupt"), { method: "POST" }).catch(() => {});
  }, []);

  const rewind = useCallback(async (sha: string) => {
    const d = daemonRef.current;
    if (!d) return false;
    const res = await fetch(daemonEndpoint(d, "/rewind"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sha }),
    }).catch(() => null);
    return !!res?.ok;
  }, []);

  return { events, deltas, status, tool, queue, assetsSignal, say, stop, rewind, saying };
}
