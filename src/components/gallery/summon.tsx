"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

// The "begin invocation" doorway — mints a fresh project, then crosses into it.
export function Summon({ delay }: { delay: number }) {
  const ref = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function begin() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/projects", { method: "POST" });
      if (!res.ok) throw new Error();
      const { id } = (await res.json()) as { id: string };
      router.push(`/invocation/${id}`);
    } catch {
      setBusy(false);
    }
  }

  return (
    <button
      ref={ref}
      className="summon manifest"
      style={{ ["--d" as string]: delay }}
      onClick={begin}
      disabled={busy}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el) return;
        const b = el.getBoundingClientRect();
        el.style.setProperty("--mx", (((e.clientX - b.left) / b.width) * 100).toFixed(1) + "%");
        el.style.setProperty("--my", (((e.clientY - b.top) / b.height) * 100).toFixed(1) + "%");
      }}
    >
      <span className="inner-fog" aria-hidden="true" />
      <span className="sigil-mark" aria-hidden="true">
        <svg width="34" height="34" viewBox="0 0 22 22" fill="none">
          <path
            d="M4.5 17.5h4.2c-2.4-1.3-4-3.6-4-6.5a6.3 6.3 0 1 1 12.6 0c0 2.9-1.6 5.2-4 6.5h4.2"
            stroke="#7FF7E4"
            strokeOpacity="0.9"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <h2>{busy ? "Opening…" : "Begin Invocation"}</h2>
      <p>Offer what remains of a brand. The Phantom reads the rest.</p>
    </button>
  );
}
