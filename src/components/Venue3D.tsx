"use client";

import { useEffect, useRef, useState } from "react";
import type { GateState, MapStatus, Projected, Stadium3D } from "@/lib/stadium3d";
import { usePrefersReducedMotion } from "./ui";

export type { MapStatus } from "@/lib/stadium3d";

// Misma paleta que la ilustración: grafito, papel crema y el naranja del techo.
const INK = "#3a3734";
const PAPER = "#f9f1e6";
const ORANGE = "#e8841f";
const AMBER = "#efb25e";
const FILL: Record<MapStatus, string> = { good: PAPER, warning: AMBER, serious: ORANGE, critical: ORANGE };
const BAR: Record<MapStatus, string> = { good: INK, warning: AMBER, serious: ORANGE, critical: ORANGE };

export interface MapCallout {
  id: string;
  at: string; // gate:C · bar:4 · spot:1 · pista · escenario
  kicker: string;
  text: string;
  status: MapStatus;
}

interface Props {
  mode: "hero" | "ops";
  gates: Record<string, GateState>;
  density: number;
  bars?: number[];
  spots?: boolean;
  callouts?: MapCallout[];
  selected?: string;
  onSelect?: (gate: string) => void;
  className?: string;
}

const GATE_IDS = "ABCDEFGH".split("");

// Maqueta 3D del estadio con etiquetas HTML encima. Three.js se carga sólo en el
// navegador, se pausa fuera de pantalla y con "reducir movimiento" queda fija.
// Si no hay WebGL, se muestra la ilustración original.
export function Venue3D({ mode, gates, density, bars, spots = true, callouts = [], selected, onSelect, className = "" }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Stadium3D | null>(null);
  const els = useRef<Record<string, HTMLElement | null>>({});
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    let disposed = false;
    let io: IntersectionObserver | null = null;
    let ro: ResizeObserver | null = null;
    const animated = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lowPower = window.innerWidth < 700 || (navigator.hardwareConcurrency ?? 8) <= 4;

    const place = (pts: Record<string, Projected>, w: number) => {
      for (const [key, p] of Object.entries(pts)) {
        const el = els.current[key];
        if (!el) continue;
        const card = key.startsWith("mk:");
        const half = card ? el.offsetWidth / 2 + 6 : 0;
        const x = card ? Math.min(Math.max(p.x, half), w - half) : p.x;
        el.style.transform = `translate(${x}px, ${p.y}px) translate(-50%, -100%)`;
        el.style.opacity = p.visible ? "1" : "0";
        if (card) {
          const stem = el.querySelector<HTMLElement>("[data-stem]");
          if (stem) stem.style.left = `${p.x - x + el.offsetWidth / 2}px`;
        }
      }
    };

    import("@/lib/stadium3d")
      .then(({ Stadium3D }) => {
        if (disposed || !canvasRef.current || !wrapRef.current) return;
        let scene: Stadium3D;
        try {
          scene = new Stadium3D(canvasRef.current, { mode, lowPower, animated, onFrame: (p, w) => place(p, w) });
        } catch {
          setFailed(true);
          return;
        }
        sceneRef.current = scene;
        setReady(true);
        const wrap = wrapRef.current;
        ro = new ResizeObserver(([e]) => scene.resize(Math.max(1, e.contentRect.width), Math.max(1, e.contentRect.height)));
        ro.observe(wrap);
        scene.resize(wrap.clientWidth, wrap.clientHeight);
        if (!animated) {
          scene.renderStill();
          return;
        }
        io = new IntersectionObserver(([e]) => scene.setRunning(e.isIntersecting), { threshold: 0.02 });
        io.observe(wrap);
      })
      .catch(() => setFailed(true));

    return () => {
      disposed = true;
      io?.disconnect();
      ro?.disconnect();
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [mode]);

  const markerKey = callouts.map((c) => `${c.id}:${c.status}`).join("|");
  const gateKey = JSON.stringify(gates);
  const barKey = (bars ?? []).join(",");
  useEffect(() => {
    sceneRef.current?.setState({
      gates,
      density,
      bars,
      spots,
      selected,
      markers: callouts.map((c) => ({ id: c.id, at: c.at, status: c.status })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, gateKey, density, barKey, spots, selected, markerKey]);

  if (failed) {
    return (
      <div className={`relative overflow-hidden ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/estadio.webp" alt="Ilustración del estadio" className="h-full w-full object-cover" />
      </div>
    );
  }

  const small = mode === "ops";

  return (
    <div ref={wrapRef} className={`relative select-none overflow-hidden ${className}`} style={{ background: PAPER }}>
      <canvas ref={canvasRef} className={`absolute inset-0 h-full w-full ${reduced ? "" : "cursor-grab active:cursor-grabbing"} touch-pan-y`} aria-hidden />
      <div className="pointer-events-none absolute inset-0" aria-hidden={!onSelect}>
        {/* Puertas */}
        {GATE_IDS.map((id) => {
          const g = gates[id];
          if (!g) return null;
          const sel = selected === id;
          const Tag = onSelect ? "button" : "span";
          return (
            <Tag
              key={id}
              ref={(el: HTMLElement | null) => {
                els.current[`gate:${id}`] = el;
              }}
              {...(onSelect ? { type: "button" as const, onClick: () => onSelect(id), "aria-label": `Puerta ${id}`, "aria-pressed": sel } : {})}
              className={`absolute left-0 top-0 flex items-center justify-center rounded-full border-2 font-bold opacity-0 transition-[background,box-shadow] duration-300 ${
                small ? "h-5 w-5 text-[10px] sm:h-6 sm:w-6 sm:text-[11px]" : "h-5 w-5 text-[10px] sm:h-8 sm:w-8 sm:text-sm"
              } ${onSelect ? "pointer-events-auto cursor-pointer" : ""}`}
              style={{
                background: FILL[g.status],
                borderColor: INK,
                color: INK,
                fontFamily: "var(--font-display)",
                boxShadow: sel ? `0 0 0 3px ${PAPER}, 0 0 0 5px ${INK}` : "0 2px 6px rgba(58,55,52,0.25)",
              }}
            >
              {id}
            </Tag>
          );
        })}
        {/* Barras */}
        {bars?.map((q, i) => (
          <span
            key={`bar${i}`}
            ref={(el) => {
              els.current[`bar:${i + 1}`] = el;
            }}
            className={`absolute left-0 top-0 whitespace-nowrap rounded-sm border px-1 text-[10px] leading-4 opacity-0 ${q > 8 ? "" : "max-sm:hidden"}`}
            style={{ background: q > 8 ? ORANGE : PAPER, borderColor: INK, color: INK, fontFamily: "var(--font-mono)" }}
          >
            B{i + 1}
            {q > 8 ? <span className="tabular"> · {Math.round(q)}′</span> : null}
          </span>
        ))}
        {/* Spots */}
        {spots &&
          [1, 2, 3, 4, 5].map((n) => (
            <span
              key={`s${n}`}
              ref={(el) => {
                els.current[`spot:${n}`] = el;
              }}
              className="absolute left-0 top-0 text-[10px] font-semibold tracking-[0.12em] opacity-0 max-sm:hidden"
              style={{ color: INK, fontFamily: "var(--font-mono)" }}
            >
              S{n}
            </span>
          ))}
        {/* Llamadas del copiloto, ancladas al haz de luz del evento */}
        {callouts.map((c) => (
          <div
            key={c.id}
            ref={(el) => {
              els.current[`mk:${c.id}`] = el;
            }}
            className="absolute left-0 top-0 pb-3 opacity-0 transition-opacity duration-300"
          >
            <div
              className={`animate-[fadein_0.4s_ease] rounded-md border-[1.5px] shadow-[0_6px_18px_rgba(58,55,52,0.18)] ${small ? "max-w-[210px] px-2.5 py-1.5" : "max-w-[260px] px-3 py-2"} max-sm:max-w-[180px] max-sm:px-2 max-sm:py-1`}
              style={{ background: PAPER, borderColor: INK }}
            >
              <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.16em] text-[#8a8178] sm:text-[10px]">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: BAR[c.status], boxShadow: c.status === "good" ? "none" : `0 0 0 3px ${ORANGE}33` }} />
                {c.kicker}
              </p>
              <p className={`mt-0.5 leading-snug ${small ? "text-[11px]" : "text-[11px] sm:text-[13px]"}`} style={{ color: INK }}>
                {c.text}
              </p>
            </div>
            <span data-stem className="absolute bottom-0 h-3 w-px" style={{ background: INK }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// Leyenda con los mismos colores del mapa (color + forma + texto).
export function MapLegend() {
  const items: { s: MapStatus; label: string }[] = [
    { s: "good", label: "Fluido" },
    { s: "warning", label: "Atención" },
    { s: "critical", label: "Saturado" },
  ];
  return (
    <span className="flex flex-wrap items-center gap-3">
      {items.map((x) => (
        <span key={x.s} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full border" style={{ borderColor: INK, background: FILL[x.s] }} />
          {x.label}
        </span>
      ))}
    </span>
  );
}
