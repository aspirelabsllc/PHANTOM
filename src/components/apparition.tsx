"use client";

import { useEffect, useRef } from "react";

/* ============================================================
   PHANTOM — the Apparition
   A field of vapor that condenses into form. Ported from the
   design's vanilla-JS engine. No deps, rAF, DPR-aware.
   ============================================================ */

type Pt = [number, number];
type ShapeDef = { lines: Pt[][] };
type ShapeName = "site" | "sigil";

function rect(x: number, y: number, w: number, h: number): Pt[][] {
  return [
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
      [x, y],
    ],
  ];
}

const SHAPES: Record<ShapeName, () => ShapeDef> = {
  // site-glyph: hero bar + two columns inside a frame
  site() {
    const lines: Pt[][] = [];
    lines.push(...rect(0, 0, 1, 0.72));
    lines.push(...rect(0.065, 0.07, 0.87, 0.185));
    lines.push([
      [0.13, 0.1625],
      [0.46, 0.1625],
    ]);
    lines.push(...rect(0.065, 0.335, 0.415, 0.315));
    lines.push(...rect(0.52, 0.335, 0.415, 0.315));
    lines.push([
      [0.13, 0.425],
      [0.415, 0.425],
    ]);
    lines.push([
      [0.585, 0.425],
      [0.87, 0.425],
    ]);
    lines.push([
      [0.13, 0.49],
      [0.36, 0.49],
    ]);
    lines.push([
      [0.585, 0.49],
      [0.815, 0.49],
    ]);
    return { lines };
  },
  // the Ω-sigil
  sigil() {
    const cx = 0.5,
      cy = 0.42,
      r = 0.34;
    const a0 = Math.PI / 2 + 0.52;
    const a1 = Math.PI / 2 - 0.52 + Math.PI * 2;
    const arc: Pt[] = [];
    const STEPS = 84;
    for (let i = 0; i <= STEPS; i++) {
      const a = a0 + (a1 - a0) * (i / STEPS);
      arc.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    const lx = cx + r * Math.cos(a0),
      ly = cy + r * Math.sin(a0);
    const rx = cx + r * Math.cos(a1 - Math.PI * 2),
      ry = cy + r * Math.sin(a1 - Math.PI * 2);
    return {
      lines: [
        arc,
        [
          [lx, ly],
          [lx - 0.155, ly],
        ],
        [
          [rx, ry],
          [rx + 0.155, ry],
        ],
      ],
    };
  },
};

function samplePolylines(lines: Pt[][], n: number, jitter = 0.005): Pt[] {
  const segs: { x1: number; y1: number; x2: number; y2: number; len: number }[] = [];
  let total = 0;
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const x1 = line[i][0],
        y1 = line[i][1];
      const x2 = line[i + 1][0],
        y2 = line[i + 1][1];
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len > 1e-6) {
        segs.push({ x1, y1, x2, y2, len });
        total += len;
      }
    }
  }
  const pts: Pt[] = [];
  for (const s of segs) {
    const k = Math.max(1, Math.round(n * (s.len / total)));
    for (let i = 0; i < k; i++) {
      const t = (i + Math.random() * 0.92) / k;
      pts.push([
        s.x1 + (s.x2 - s.x1) * t + (Math.random() - 0.5) * jitter,
        s.y1 + (s.y2 - s.y1) * t + (Math.random() - 0.5) * jitter,
      ]);
    }
  }
  for (let i = pts.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const tmp = pts[i];
    pts[i] = pts[j];
    pts[j] = tmp;
  }
  return pts;
}

type Opts = {
  count: number;
  fade: number;
  scale: number;
  yShift: number;
  shape: ShapeName;
  attraction: number;
  repelRadius: number;
  kScale: number; // multiplies per-particle pull; <1 = slower, perpetually almost-there
  bg: [number, number, number];
};

type Part = {
  x: number;
  y: number;
  a: number;
  sp: number;
  tx: number;
  ty: number;
  sz: number;
  col: string;
  alBase: number;
  ph: number;
  fl: number;
  k: number;
};

class Apparition {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  o: Opts;
  parts: Part[] = [];
  mouse = { x: -1e4, y: -1e4 };
  state: "vapor" | "condensing" = "vapor";
  t = 0;
  _last = performance.now();
  _raf = 0;
  _cycle?: number;
  w = 1;
  h = 1;
  reduced: boolean;
  _onResize: () => void;
  _onMove: (e: PointerEvent) => void;
  _onLeave: () => void;

  constructor(canvas: HTMLCanvasElement, opts: Partial<Opts>, reduced: boolean) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.reduced = reduced;
    this.o = Object.assign(
      {
        count: 760,
        fade: 0.14,
        scale: 0.62,
        yShift: 0,
        shape: "site" as ShapeName,
        attraction: 0.05,
        repelRadius: 96,
        kScale: 1,
        bg: [7, 7, 11] as [number, number, number],
      },
      opts,
    );

    this._onResize = () => {
      this._resize();
      if (this.state !== "vapor") this._retarget();
      this._paintBase();
    };
    window.addEventListener("resize", this._onResize);

    this._onMove = (e: PointerEvent) => {
      const b = this.canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - b.left;
      this.mouse.y = e.clientY - b.top;
    };
    this._onLeave = () => {
      this.mouse.x = -1e4;
      this.mouse.y = -1e4;
    };
    window.addEventListener("pointermove", this._onMove, { passive: true });
    window.addEventListener("pointerleave", this._onLeave);

    this._resize();
    this._seed();
    this._paintBase();

    if (this.reduced) {
      this._retarget();
      for (const p of this.parts) {
        p.x = p.tx;
        p.y = p.ty;
      }
      this.state = "condensing";
      this._renderStatic();
      return;
    }

    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener("resize", this._onResize);
    window.removeEventListener("pointermove", this._onMove);
    window.removeEventListener("pointerleave", this._onLeave);
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.canvas.clientWidth || 1;
    this.h = this.canvas.clientHeight || 1;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _paintBase() {
    const b = this.o.bg;
    this.ctx.fillStyle = "rgb(" + b[0] + "," + b[1] + "," + b[2] + ")";
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  _seed() {
    const COLORS = [
      { c: "rgb(221,227,255)", a: 0.62, w: 0.74 },
      { c: "rgb(127,247,228)", a: 0.72, w: 0.14 },
      { c: "rgb(157,140,255)", a: 0.6, w: 0.12 },
    ];
    const pick = () => {
      const r = Math.random();
      let acc = 0;
      for (const k of COLORS) {
        acc += k.w;
        if (r <= acc) return k;
      }
      return COLORS[0];
    };
    this.parts.length = 0;
    for (let i = 0; i < this.o.count; i++) {
      const k = pick();
      this.parts.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        a: Math.random() * Math.PI * 2,
        sp: 0.12 + Math.random() * 0.26,
        tx: 0,
        ty: 0,
        sz: 0.8 + Math.random() * 1.1,
        col: k.c,
        alBase: k.a * (0.55 + Math.random() * 0.45),
        ph: Math.random() * Math.PI * 2,
        fl: 0.6 + Math.random() * 1.4,
        k: (0.035 + Math.random() * 0.03) * this.o.kScale,
      });
    }
  }

  _retarget() {
    const def = SHAPES[this.o.shape] ? SHAPES[this.o.shape]() : SHAPES.site();
    const raw = samplePolylines(def.lines, this.parts.length);

    let minX = 1e9,
      minY = 1e9,
      maxX = -1e9,
      maxY = -1e9;
    for (const p of raw) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    const bw = maxX - minX || 1,
      bh = maxY - minY || 1;
    const box = Math.min(this.w, this.h) * this.o.scale;
    const s = Math.min((box * 1.35) / bw, box / bh);
    const ox = (this.w - bw * s) / 2 - minX * s;
    const oy = (this.h - bh * s) / 2 - minY * s + this.h * this.o.yShift;

    for (let i = 0; i < this.parts.length; i++) {
      const src = raw[i % raw.length];
      this.parts[i].tx = src[0] * s + ox;
      this.parts[i].ty = src[1] * s + oy;
    }
  }

  condense(shape?: ShapeName) {
    if (shape) this.o.shape = shape;
    this._retarget();
    this.state = "condensing";
    if (this.reduced) {
      for (const p of this.parts) {
        p.x = p.tx;
        p.y = p.ty;
      }
      this._renderStatic();
    }
  }

  dissolve() {
    this.state = "vapor";
    for (const p of this.parts) {
      p.a = Math.random() * Math.PI * 2;
      p.sp = 0.2 + Math.random() * 0.5;
    }
  }

  toggle(shapes: ShapeName[] = ["site", "sigil"]) {
    if (this.state === "vapor") {
      this.condense(shapes[0]);
      this._cycle = 0;
    } else if (this._cycle === 0) {
      this.condense(shapes[1]);
      this._cycle = 1;
    } else {
      this.dissolve();
      this._cycle = undefined;
    }
  }

  _step(dt: number) {
    const R = this.o.repelRadius,
      R2 = R * R;
    const mx = this.mouse.x,
      my = this.mouse.y;
    const condensing = this.state === "condensing";
    const t = this.t;

    for (const p of this.parts) {
      if (condensing) {
        const wob = 1.1;
        const txx = p.tx + Math.sin(t * 0.0011 * p.fl + p.ph) * wob;
        const tyy = p.ty + Math.cos(t * 0.0009 * p.fl + p.ph * 1.7) * wob;
        p.x += (txx - p.x) * p.k * (dt / 16.7);
        p.y += (tyy - p.y) * p.k * (dt / 16.7);
        p.a += (Math.random() - 0.5) * 0.09;
        p.x += Math.cos(p.a) * p.sp * 0.25;
        p.y += Math.sin(p.a) * p.sp * 0.25;
      } else {
        p.a += (Math.random() - 0.5) * 0.085;
        p.x += Math.cos(p.a) * p.sp * (dt / 16.7);
        p.y += Math.sin(p.a) * p.sp * 0.72 * (dt / 16.7);
        if (p.x < -8) p.x = this.w + 8;
        else if (p.x > this.w + 8) p.x = -8;
        if (p.y < -8) p.y = this.h + 8;
        else if (p.y > this.h + 8) p.y = -8;
      }

      const dx = p.x - mx,
        dy = p.y - my;
      const d2 = dx * dx + dy * dy;
      if (d2 < R2 && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const f = (1 - d / R) * 1.35 * (dt / 16.7);
        p.x += (dx / d) * f;
        p.y += (dy / d) * f;
      }
    }
  }

  _render() {
    const ctx = this.ctx;
    const b = this.o.bg;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(" + b[0] + "," + b[1] + "," + b[2] + "," + this.o.fade + ")";
    ctx.fillRect(0, 0, this.w, this.h);

    const t = this.t;
    for (const p of this.parts) {
      const flicker = 0.55 + 0.45 * Math.sin(t * 0.0016 * p.fl + p.ph);
      ctx.globalAlpha = p.alBase * flicker;
      ctx.fillStyle = p.col;
      ctx.fillRect(p.x, p.y, p.sz, p.sz);
    }
    ctx.globalAlpha = 1;
  }

  _renderStatic() {
    this._paintBase();
    const ctx = this.ctx;
    for (const p of this.parts) {
      ctx.globalAlpha = p.alBase * 0.85;
      ctx.fillStyle = p.col;
      ctx.fillRect(p.x, p.y, p.sz, p.sz);
    }
    ctx.globalAlpha = 1;
  }

  _loop(now: number) {
    const dt = Math.min(now - this._last, 50);
    this._last = now;
    this.t += dt;
    this._step(dt);
    this._render();
    this._raf = requestAnimationFrame(this._loop);
  }
}

export function ApparitionField({
  className,
  options,
  condenseDelay = 1400,
  cycle = ["site", "sigil"],
  interactive = true,
  ariaHidden = false,
}: {
  className?: string;
  options?: Partial<Opts>;
  condenseDelay?: number;
  cycle?: ShapeName[];
  interactive?: boolean;
  ariaHidden?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<Apparition | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const app = new Apparition(canvas, options ?? {}, reduced);
    appRef.current = app;

    let timer: number | undefined;
    if (!reduced && condenseDelay >= 0) {
      timer = window.setTimeout(() => app.condense(options?.shape ?? "site"), condenseDelay);
    }
    return () => {
      if (timer) clearTimeout(timer);
      app.destroy();
      appRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={ref}
      className={`apparition ${className ?? ""}`}
      onClick={interactive ? () => appRef.current?.toggle(cycle) : undefined}
      style={interactive ? undefined : { pointerEvents: "none" }}
      {...(ariaHidden
        ? { "aria-hidden": true }
        : {
            "aria-label":
              "The Apparition — a field of vapor condensing into the form of a website. Click to re-condense.",
          })}
    />
  );
}
