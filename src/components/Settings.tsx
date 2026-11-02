"use client";

import { useEffect, useState } from "react";
import type { ConsoleState, EventConfig } from "@/lib/types";

const input = "w-full border border-ink bg-surface px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ink";
const label = "text-[10px] uppercase tracking-[0.14em] text-muted";

export function Settings() {
  const [cfg, setCfg] = useState<EventConfig | null>(null);
  const [flags, setFlags] = useState<Pick<ConsoleState, "storage" | "ingestEnabled" | "copilotAI"> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [origin, setOrigin] = useState("https://tu-proyecto.vercel.app");

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch("/api/config", { cache: "no-store" })
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => setMsg("No se pudo cargar la configuración"));
    fetch("/api/state", { cache: "no-store" })
      .then((r) => r.json())
      .then((s: ConsoleState) => setFlags({ storage: s.storage, ingestEnabled: s.ingestEnabled, copilotAI: s.copilotAI }))
      .catch(() => undefined);
  }, []);

  if (!cfg) return <main className="mx-auto max-w-5xl px-4 py-16 text-sm text-ink-2">{msg ?? "Cargando…"}</main>;

  const set = <K extends keyof EventConfig>(k: K, v: EventConfig[K]) => setCfg({ ...cfg, [k]: v });
  const shareSum = cfg.gates.reduce((a, g) => a + g.share, 0);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setCfg(data);
      setMsg("Guardado. La consola ya usa esta configuración.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const curl = `curl -X POST ${origin}/api/ingest \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: $INGEST_API_KEY" \\
  -d '{"events":[
    {"type":"scan","gate":"C","count":42},
    {"type":"queue","gate":"C","people":380},
    {"type":"sale","bar":"4","amount":1250.5,"count":7},
    {"type":"bar_queue","bar":"4","minutes":9},
    {"type":"density","value":3.4},
    {"type":"alert","area":"SEG","text":"Objeto olvidado en Acceso B","severity":"warning","at":"gate:B"}
  ]}'`;

  return (
    <main className="mx-auto max-w-5xl px-3 pb-16 pt-6 sm:px-4">
      <div className="sheet px-5 py-8 sm:px-10">
        <p className="tracked-sm text-[10px] text-muted">Configuración</p>
        <h1 className="tracked mt-2 text-xl">Evento, recinto y fuente de datos</h1>

        {/* Fuente */}
        <section className="mt-8">
          <h2 className="tracked-sm text-[11px] text-muted">Fuente de datos</h2>
          <div className="mt-3 grid max-w-xl grid-cols-2 border border-ink" role="radiogroup" aria-label="Fuente de datos">
            {(["sim", "live"] as const).map((src) => (
              <button
                key={src}
                type="button"
                role="radio"
                aria-checked={cfg.source === src}
                onClick={() => set("source", src)}
                className={`px-4 py-3 text-left ${cfg.source === src ? "bg-ink text-surface" : "hover:bg-surface-2"}`}
              >
                <span className="block text-[11px] uppercase tracking-[0.16em]">{src === "sim" ? "Simulador" : "En vivo"}</span>
                <span className="mt-1 block text-xs opacity-80">{src === "sim" ? "Evento sintético para demos y capacitación" : "Datos reales recibidos en /api/ingest"}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Evento */}
        <section className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <h2 className="tracked-sm text-[11px] text-muted sm:col-span-2 lg:col-span-4">Evento</h2>
          <Field l="Nombre" className="sm:col-span-2">
            <input className={input} value={cfg.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field l="Recinto" className="sm:col-span-2">
            <input className={input} value={cfg.venue} onChange={(e) => set("venue", e.target.value)} />
          </Field>
          <Field l="Fecha">
            <input type="date" className={input} value={cfg.date} onChange={(e) => set("date", e.target.value)} />
          </Field>
          <Field l="Zona horaria">
            <input className={input} value={cfg.timezone} onChange={(e) => set("timezone", e.target.value)} />
          </Field>
          <Field l="Apertura de puertas">
            <input type="time" className={input} value={cfg.doorsOpen} onChange={(e) => set("doorsOpen", e.target.value)} />
          </Field>
          <Field l="Inicio del show">
            <input type="time" className={input} value={cfg.showStart} onChange={(e) => set("showStart", e.target.value)} />
          </Field>
          <Field l="Aforo">
            <input type="number" className={input} value={cfg.capacity} onChange={(e) => set("capacity", Number(e.target.value))} />
          </Field>
          <Field l="Boletos vendidos">
            <input type="number" className={input} value={cfg.ticketsSold} onChange={(e) => set("ticketsSold", Number(e.target.value))} />
          </Field>
          <Field l="Escaneos por carril / min">
            <input type="number" className={input} value={cfg.scanRatePerLane} onChange={(e) => set("scanRatePerLane", Number(e.target.value))} />
          </Field>
          <Field l="Copiloto automático">
            <label className="flex items-center gap-2 py-1.5 text-sm">
              <input type="checkbox" checked={cfg.autopilot} onChange={(e) => set("autopilot", e.target.checked)} className="h-4 w-4 accent-[var(--ink)]" />
              Ejecuta sus acciones sin esperar aprobación
            </label>
          </Field>
        </section>

        {/* Umbrales */}
        <section className="mt-10 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <h2 className="tracked-sm text-[11px] text-muted sm:col-span-3 lg:col-span-5">Umbrales del copiloto</h2>
          {(["warning", "serious", "critical"] as const).map((k) => (
            <Field key={k} l={`Espera ${k === "warning" ? "atención" : k === "serious" ? "saturada" : "crítica"} (min)`}>
              <input type="number" className={input} value={cfg.thresholds[k]} onChange={(e) => set("thresholds", { ...cfg.thresholds, [k]: Number(e.target.value) })} />
            </Field>
          ))}
          <Field l="Fila en barra (min)">
            <input type="number" className={input} value={cfg.barQueueAlert} onChange={(e) => set("barQueueAlert", Number(e.target.value))} />
          </Field>
          <Field l="Densidad en pista (p/m²)">
            <input type="number" step="0.1" className={input} value={cfg.densityAlert} onChange={(e) => set("densityAlert", Number(e.target.value))} />
          </Field>
        </section>

        {/* Puertas */}
        <section className="mt-10">
          <h2 className="tracked-sm text-[11px] text-muted">Accesos (A–H, como en el mapa)</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-ink text-left text-[10px] uppercase tracking-[0.12em] text-muted">
                  <th className="py-1.5 font-normal">Id</th>
                  <th className="py-1.5 font-normal">Nombre</th>
                  <th className="py-1.5 font-normal">% de boletos</th>
                  <th className="py-1.5 font-normal">Carriles</th>
                  <th className="py-1.5 font-normal">Máximo</th>
                </tr>
              </thead>
              <tbody>
                {cfg.gates.map((g, i) => {
                  const upd = (patch: Partial<typeof g>) => set("gates", cfg.gates.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                  return (
                    <tr key={g.id} className="border-b border-line">
                      <td className="py-1.5 pr-2 font-semibold">{g.id}</td>
                      <td className="py-1.5 pr-2">
                        <input className={input} value={g.name} onChange={(e) => upd({ name: e.target.value })} aria-label={`Nombre de la puerta ${g.id}`} />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input type="number" step="0.5" className={input} value={+(g.share * 100).toFixed(1)} onChange={(e) => upd({ share: Number(e.target.value) / 100 })} aria-label={`Porcentaje de boletos de la puerta ${g.id}`} />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input type="number" className={input} value={g.lanes} onChange={(e) => upd({ lanes: Number(e.target.value) })} aria-label={`Carriles de la puerta ${g.id}`} />
                      </td>
                      <td className="py-1.5">
                        <input type="number" className={input} value={g.lanesMax} onChange={(e) => upd({ lanesMax: Number(e.target.value) })} aria-label={`Carriles máximos de la puerta ${g.id}`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted">Suma: {(shareSum * 100).toFixed(1)}%. Al guardar se reparte proporcionalmente para que sume 100%.</p>
        </section>

        {/* Barras */}
        <section className="mt-10">
          <h2 className="tracked-sm text-[11px] text-muted">Barras (1–6, como en el mapa)</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cfg.bars.map((b, i) => {
              const upd = (patch: Partial<typeof b>) => set("bars", cfg.bars.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={b.id} className="grid grid-cols-[1fr_5rem] gap-2">
                  <input className={input} value={b.name} onChange={(e) => upd({ name: e.target.value })} aria-label={`Nombre de la barra ${b.id}`} />
                  <input type="number" className={input} value={b.registers} onChange={(e) => upd({ registers: Number(e.target.value) })} aria-label={`Cajas de la barra ${b.id}`} title="Cajas abiertas" />
                </div>
              );
            })}
          </div>
        </section>

        <div className="sticky bottom-3 mt-10 flex flex-wrap items-center gap-4 border border-ink bg-surface px-4 py-3">
          <button type="button" onClick={save} disabled={saving} className="bg-ink px-5 py-2 text-[11px] uppercase tracking-[0.14em] text-surface disabled:opacity-50">
            {saving ? "Guardando…" : "Guardar configuración"}
          </button>
          {msg && (
            <p role="status" className="text-sm text-ink-2">
              {msg}
            </p>
          )}
        </div>

        {/* Integraciones */}
        <section className="mt-12 border-t border-ink pt-8">
          <h2 className="tracked-sm text-[11px] text-muted">Conectar datos reales</h2>
          {flags && (
            <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
              <Flag ok={flags.ingestEnabled} on="Ingesta habilitada" off="Falta INGEST_API_KEY" />
              <Flag ok={flags.storage === "redis"} on="Redis conectado (persistente)" off="Memoria: conecta Upstash Redis" />
              <Flag ok={flags.copilotAI} on="Copiloto con Claude" off="Copiloto por reglas (falta ANTHROPIC_API_KEY)" />
            </ul>
          )}
          <p className="mt-4 text-sm text-ink-2">
            Envía escaneos del boletaje, ventas del POS o del adquirente, sensores de fila y densidad, y alertas de cualquier área a <code className="bg-surface-2 px-1">{origin}/api/ingest</code>. Cada evento puede traer
            <code className="bg-surface-2 px-1">ts</code> (ISO o milisegundos); si no, se usa la hora de llegada. Se aceptan hasta 5,000 eventos por petición.
          </p>
          <pre className="mt-4 overflow-x-auto bg-ink p-4 text-[11px] leading-relaxed text-surface">{curl}</pre>
          <p className="mt-3 text-[11px] text-muted">
            Para que la consola muestre estos datos, la fuente debe estar en «En vivo». Las anclas del mapa para alertas son <code>gate:A</code>–<code>gate:H</code>, <code>bar:1</code>–<code>bar:6</code>,{" "}
            <code>spot:1</code>–<code>spot:5</code> y <code>pista</code>.
          </p>
        </section>
      </div>
    </main>
  );
}

function Field({ l, children, className = "" }: { l: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className={label}>{l}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function Flag({ ok, on, off }: { ok: boolean; on: string; off: string }) {
  return (
    <li className="flex items-center gap-2 border border-line px-3 py-2">
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: ok ? "var(--good)" : "var(--warning)" }} />
      {ok ? on : off}
    </li>
  );
}
