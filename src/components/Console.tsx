"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, CircleCheck, OctagonAlert, Pause, Play, RotateCcw, Send, TriangleAlert, type LucideIcon } from "lucide-react";
import { AREA_LABEL, STATUS_LABEL, type Action, type Area, type ConsoleState, type FeedEvent, type Status } from "@/lib/types";
import { MapLegend, Venue3D, type MapCallout } from "./Venue3D";
import { fmt, money } from "./ui";

const STATUS_ICON: Record<Status, LucideIcon> = { good: CircleCheck, warning: TriangleAlert, serious: CircleAlert, critical: OctagonAlert };
const STATUS_COLOR: Record<Status, string> = { good: "var(--good)", warning: "var(--warning)", serious: "var(--serious)", critical: "var(--critical)" };
const SPEEDS = [1, 5, 10, 30];
const KIND_LABEL: Record<FeedEvent["kind"], string> = { alerta: "Alerta", accion: "Acción", aviso: "Aviso", dato: "Dato", resuelto: "Resuelto" };
const QUICK = ["¿Qué puerta está peor?", "¿Cuánta gente falta?", "Resumen para Protección Civil", "¿Qué hizo el copiloto?"];

export function clockFrom(doorsOpen: string, minute: number) {
  const [h, m] = doorsOpen.split(":").map(Number);
  const t = (((h * 60 + m + Math.floor(minute)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

async function post(url: string, body: unknown, method = "POST") {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Error ${res.status}`);
  return data;
}

function useLiveState() {
  const [state, setState] = useState<ConsoleState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<number>(0);
  const inflight = useRef(false);
  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setState(data);
      setError(null);
      setLastOk(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inflight.current = false;
    }
  }, []);
  const every = state?.source === "live" ? 5000 : state?.running ? 1500 : 4000;
  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, every);
    return () => clearInterval(id);
  }, [refresh, every]);
  return { state, error, refresh, lastOk };
}

export function Console() {
  const { state: s, error, refresh, lastOk } = useLiveState();
  const [filter, setFilter] = useState<Area | "ALL">("ALL");
  const [selected, setSelected] = useState("C");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ q: string; a: string; by: string } | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setToast((e as Error).message);
      setTimeout(() => setToast(null), 4000);
    } finally {
      setBusy(null);
    }
  };

  const ask = async (q: string) => {
    if (!q.trim()) return;
    setAsking(true);
    try {
      const r = (await post("/api/copilot", { question: q })) as { answer: string; by: string };
      setAnswer({ q, a: r.answer, by: r.by });
      setQuestion("");
    } catch (e) {
      setAnswer({ q, a: (e as Error).message, by: "error" });
    } finally {
      setAsking(false);
    }
  };

  const callouts = useMemo<MapCallout[]>(() => {
    if (!s) return [];
    const now = Math.floor(s.minute);
    return s.feed
      .filter((e) => e.at && now - e.minute <= 10)
      .slice(0, 2)
      .map((e) => {
        const [kind, id] = e.at!.split(":");
        const place = kind === "gate" ? `Puerta ${id}` : kind === "bar" ? `Barra ${id}` : kind === "spot" ? `Spot ${id}` : "Pista";
        const text = e.text.split(" — ")[0].replace(/^(Puerta|Acceso|Spot) \w+ · /, "").replace(/^Barra \d[^·]*· /, "").replace(/^Pista[^·]*· /, "");
        return {
          id: e.id,
          at: e.at!,
          kicker: `${clockFrom(s.event.doorsOpen, e.minute)} · ${place} · ${AREA_LABEL[e.area]}`,
          text,
          status: e.severity ?? (e.kind === "accion" ? "warning" : "good"),
        };
      });
  }, [s]);

  if (!s) {
    return (
      <main className="mx-auto max-w-[1500px] px-4 py-16 text-sm text-ink-2">
        {error ? `No se pudo cargar el estado: ${error}` : "Cargando la consola…"}
      </main>
    );
  }

  const now = Math.floor(s.minute);
  const sel = s.gates.find((g) => g.id === selected) ?? s.gates[0];
  const pending = s.actions.filter((a) => a.status === "pending");
  const feed = (filter === "ALL" ? s.feed : s.feed.filter((e) => e.area === filter)).slice(0, 40);
  const actionById = new Map(s.actions.map((a) => [a.id, a]));
  const worst = [...s.gates].sort((a, b) => b.wait - a.wait)[0];
  const stale = Date.now() - lastOk > 15000;
  const mapGates = Object.fromEntries(s.gates.map((g) => [g.id, { status: g.status, flow: Math.min(1, g.arrivals / 70) }]));
  const densityLevel = s.kpis.density === null ? 0.2 : Math.max(0, Math.min(1, (s.kpis.density - 1) / 4));
  const latest = pending[0] ?? s.actions[0];

  return (
    <main className="mx-auto max-w-[1500px] px-3 pb-16 pt-4 sm:px-4">
      {/* Encabezado del evento */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink pb-4">
        <div>
          <p className="tracked-sm text-[10px] text-muted">
            {s.event.venue} · {s.event.date} · puertas {s.event.doorsOpen} · show {s.event.showStart}
          </p>
          <h1 className="tracked mt-1 text-lg sm:text-xl">{s.event.name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`flex items-center gap-1.5 border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${s.source === "live" ? "border-signal text-signal" : "border-ink text-ink"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${s.running ? "live-dot bg-signal" : "bg-[var(--baseline)]"}`} />
            {s.source === "live" ? "En vivo" : "Simulador"}
          </span>
          {(error || stale) && <span className="text-[10px] uppercase tracking-[0.14em] text-signal">Sin conexión · reintentando</span>}
          <span className="tracked-sm text-[10px] text-muted">{phaseLabel(s)}</span>
        </div>
      </div>

      {s.phase === "antes" && s.source === "live" && (
        <p className="mt-4 border border-ink bg-surface px-4 py-3 text-sm">
          Faltan {fmt(-now)} min para abrir puertas. La consola empezará a mostrar datos en cuanto lleguen escaneos a <code>/api/ingest</code>.
        </p>
      )}

      <div className="crop mt-4 border border-ink">
        {/* Barra de control */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-ink bg-surface px-4 py-3">
          {s.source === "sim" && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => run("play", () => post("/api/sim", { op: s.running ? "pause" : "play" }))}
                className="grid h-9 w-9 place-items-center bg-ink text-surface hover:opacity-85 disabled:opacity-50"
                aria-label={s.running ? "Pausar simulación" : "Reproducir simulación"}
              >
                {s.running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  if (confirm("¿Reiniciar el evento simulado? Se borran las decisiones tomadas.")) run("reset", () => post("/api/sim", { op: "reset" }));
                }}
                className="grid h-9 w-9 place-items-center border border-ink hover:bg-surface-2 disabled:opacity-50"
                aria-label="Reiniciar simulación"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
          )}
          <p className="display tabular text-3xl font-bold">{s.clock}</p>
          {s.source === "sim" && (
            <div role="group" aria-label="Velocidad del simulador" className="flex border border-ink text-[11px]">
              {SPEEDS.map((sp) => (
                <button key={sp} type="button" aria-pressed={s.speed === sp} onClick={() => run("speed", () => post("/api/sim", { op: "speed", speed: sp }))} className={`px-2.5 py-1.5 ${s.speed === sp ? "bg-ink text-surface" : "hover:bg-surface-2"}`}>
                  {sp}×
                </button>
              ))}
            </div>
          )}
          <label className="ml-auto flex cursor-pointer items-center gap-3 text-[11px] uppercase tracking-[0.14em]">
            <span className="relative inline-flex">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={s.autopilot}
                disabled={busy !== null}
                onChange={(e) => run("auto", () => post("/api/config", { autopilot: e.target.checked }, "PUT"))}
              />
              <span className="h-5 w-9 border border-ink bg-surface transition peer-checked:bg-ink peer-focus-visible:outline-2" />
              <span className="absolute left-1 top-1 h-3 w-3 bg-ink transition peer-checked:translate-x-4 peer-checked:bg-surface" />
            </span>
            Copiloto automático
          </label>
        </div>

        <Timeline s={s} onSeek={s.source === "sim" ? (m) => run("seek", () => post("/api/sim", { op: "seek", minute: m })) : undefined} />

        {/* Acciones por aprobar */}
        {pending.length > 0 && (
          <div className="border-b border-ink bg-[rgba(232,132,31,0.1)] px-4 py-3">
            <p className="tracked-sm text-[10px] text-signal">{pending.length === 1 ? "1 acción espera tu aprobación" : `${pending.length} acciones esperan tu aprobación`}</p>
            <ul className="mt-2 space-y-2">
              {pending.map((a) => (
                <ActionRow key={a.id} a={a} doorsOpen={s.event.doorsOpen} busy={busy} onDecide={(d) => run(a.id, () => post("/api/actions", { id: a.id, decision: d }))} />
              ))}
            </ul>
          </div>
        )}

        <div className="grid lg:grid-cols-[14rem_1fr_21rem]">
          {/* Indicadores */}
          <div className="grid grid-cols-2 border-b border-line lg:grid-cols-1 lg:border-b-0 lg:border-r">
            {[
              {
                k: "Dentro del recinto",
                v: fmt(s.kpis.inside),
                extra: (
                  <div className="mt-2 h-1 bg-surface-3" title={`${((s.kpis.inside / Math.max(1, s.event.ticketsSold)) * 100).toFixed(0)}% de los boletos`}>
                    <div className="h-full bg-ink" style={{ width: `${Math.min(100, (s.kpis.inside / Math.max(1, s.event.ticketsSold)) * 100)}%` }} />
                  </div>
                ),
              },
              { k: "Escaneos / min", v: fmt(s.kpis.scansPerMin), extra: <Spark values={s.series.scans.slice(-40)} /> },
              { k: "Puerta más lenta", v: `${worst.id} · ${worst.wait.toFixed(1)} min`, extra: <StatusPill status={worst.status} /> },
              { k: "Personas en fila", v: fmt(s.kpis.inQueue) },
              { k: "Alertas abiertas", v: String(s.kpis.openAlerts) },
              { k: "Acciones ejecutadas", v: String(s.kpis.actionsExecuted), extra: s.kpis.actionsPending ? <p className="mt-1 text-[10px] text-signal">{s.kpis.actionsPending} por aprobar</p> : null },
              { k: "Ventas en barras", v: money(s.kpis.salesTotal), extra: <p className="mt-1 text-[10px] text-muted">{money(s.kpis.salesPerMin)} / min</p> },
              {
                k: "Densidad en pista",
                v: s.kpis.density === null ? "sin sensor" : `${s.kpis.density.toFixed(1)} p/m²`,
                extra: s.kpis.density === null ? null : <StatusPill status={s.kpis.densityStatus} />,
              },
            ].map((x, i) => (
              <div key={x.k} className={`border-line px-4 py-3 ${i > 1 ? "border-t" : ""} ${i === 1 ? "lg:border-t" : ""} ${i % 2 ? "max-lg:border-l" : ""}`}>
                <p className="text-[10px] uppercase tracking-[0.14em] text-muted">{x.k}</p>
                <p className="tabular display mt-1 text-lg font-bold">{x.v}</p>
                {x.extra}
              </div>
            ))}
          </div>

          {/* Mapa */}
          <div className="border-b border-line bg-[var(--map-paper)] lg:border-b-0">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 text-[10px] uppercase tracking-[0.16em] text-muted">
              <span>Recinto · arrastra para girar</span>
              <MapLegend />
            </div>
            <div className="mt-2 border-y border-line">
              <Venue3D mode="ops" gates={mapGates} density={densityLevel} bars={s.bars.map((b) => b.queueMin ?? 0)} callouts={callouts} selected={selected} onSelect={setSelected} className="aspect-[4/3] w-full" />
            </div>
            <div className="grid grid-cols-8 border-t border-line">
              {s.gates.map((g, i) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setSelected(g.id)}
                  className={`px-1 py-2 text-center ${i ? "border-l border-line" : ""} ${selected === g.id ? "bg-surface" : "hover:bg-surface"}`}
                  aria-label={`${g.name}: ${g.wait.toFixed(1)} minutos, ${STATUS_LABEL[g.status]}`}
                >
                  <p className="text-[10px] font-semibold">{g.id}</p>
                  <p className="tabular text-[11px]" style={{ color: g.status === "good" ? "var(--ink-2)" : STATUS_COLOR[g.status] }}>
                    {g.wait.toFixed(1)}′
                  </p>
                </button>
              ))}
            </div>
            <div className="border-t border-line px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted">Peor espera en los próximos 30 min</p>
              <div className="mt-2 grid grid-cols-8 items-end gap-2" style={{ height: 64 }}>
                {s.gates.map((g) => (
                  <div key={g.id} className="flex h-full flex-col justify-end">
                    <span className="tabular mb-1 text-center text-[10px] text-ink-2">{g.forecastWait < 1 ? "<1" : Math.round(g.forecastWait)}′</span>
                    <span className="grow-bar w-full" style={{ height: `${Math.max(3, Math.min(100, (g.forecastWait / 45) * 100))}%`, background: g.forecastStatus === "good" ? "var(--seq-3)" : STATUS_COLOR[g.forecastStatus] }} />
                    <span className="mt-1 text-center text-[10px] font-semibold">{g.id}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="border-t border-line px-4 py-2 text-[11px] text-ink-2">
              <span className="font-semibold text-ink">{sel.name}</span> · espera {sel.wait.toFixed(1)} min · {fmt(sel.queue)} en fila ({sel.queueSource}) · {sel.lanes} de {sel.lanesMax} carriles · {fmt(sel.served)} escaneos/min
            </p>
          </div>

          {/* Bitácora */}
          <div className="flex flex-col lg:border-l lg:border-line">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="tracked-sm text-[10px]">Bitácora</p>
              <a href="/api/report?format=csv" className="text-[10px] uppercase tracking-[0.14em] text-muted underline underline-offset-4 hover:text-ink">
                CSV
              </a>
            </div>
            <div role="group" aria-label="Filtrar bitácora" className="flex flex-wrap gap-1 border-b border-line px-3 py-2">
              {(["ALL", "OPS", "SEG", "AYB", "COM", "PC", "FAN"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  title={f === "ALL" ? "Todas las áreas" : AREA_LABEL[f]}
                  onClick={() => setFilter(f)}
                  className={`px-1.5 py-0.5 text-[10px] tracking-[0.1em] ${filter === f ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2"}`}
                >
                  {f === "ALL" ? "TODO" : f}
                </button>
              ))}
            </div>
            <ol className="max-h-[640px] flex-1 overflow-y-auto" aria-live="polite">
              {feed.length === 0 && <li className="px-4 py-3 text-xs text-muted">Sin eventos todavía.</li>}
              {feed.map((e) => {
                const act = e.actionId ? actionById.get(e.actionId) : undefined;
                const Icon = e.severity ? STATUS_ICON[e.severity] : e.kind === "resuelto" ? CircleCheck : null;
                return (
                  <li key={e.id} className="feed-in border-b border-line px-4 py-2.5">
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-muted">
                      <span className="tabular text-ink">{clockFrom(s.event.doorsOpen, e.minute)}</span>
                      <span className="border border-line px-1" title={AREA_LABEL[e.area]}>
                        {e.area}
                      </span>
                      <span>{KIND_LABEL[e.kind]}</span>
                      {Icon && <Icon className="ml-auto h-3.5 w-3.5" style={{ color: e.severity ? STATUS_COLOR[e.severity] : "var(--good)" }} aria-hidden />}
                    </div>
                    <p className="mt-1 text-[12px] leading-snug">{e.text}</p>
                    {act && <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-muted">{actionStatusText(act, s.event.doorsOpen)}</p>}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        {/* Copiloto */}
        <div className="grid border-t border-ink lg:grid-cols-[1fr_1fr]">
          <div className="invert px-5 py-4">
            <p className="tracked-sm text-[10px] text-muted">Copiloto · {pending.length ? "por aprobar" : "última recomendación"}</p>
            <p className="mt-2 min-h-[3rem] text-sm leading-relaxed">
              {latest ? (
                <>
                  <span className="font-semibold">{latest.text}.</span> {latest.why}
                </>
              ) : (
                `Sin recomendaciones por ahora. Observando ${s.gates.length} puertas, ${s.bars.length} barras y la pista.`
              )}
            </p>
            <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-muted">{s.autopilot ? "Modo automático: ejecuta y documenta" : "Modo manual: tú apruebas cada acción"}</p>
          </div>
          <div className="px-5 py-4">
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map((q) => (
                <button key={q} type="button" disabled={asking} onClick={() => ask(q)} className="border border-ink px-2.5 py-1 text-[11px] hover:bg-ink hover:text-surface disabled:opacity-50">
                  {q}
                </button>
              ))}
            </div>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                ask(question);
              }}
            >
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={s.copilotAI ? "Pregunta lo que sea sobre el recinto…" : "Pregunta sobre puertas, aforo, PC o acciones…"}
                className="min-w-0 flex-1 border border-ink bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ink"
                maxLength={500}
                aria-label="Pregunta al copiloto"
              />
              <button type="submit" disabled={asking || !question.trim()} className="grid w-10 place-items-center bg-ink text-surface disabled:opacity-40" aria-label="Enviar pregunta">
                <Send className="h-4 w-4" />
              </button>
            </form>
            <p className="mt-3 min-h-[2.5rem] text-[12px] leading-relaxed text-ink-2" aria-live="polite">
              {asking ? (
                "Pensando…"
              ) : answer ? (
                <>
                  <span className="font-semibold text-ink">{answer.q}</span> {answer.a}
                  <span className="ml-1 text-[10px] uppercase tracking-[0.12em] text-muted">· {answer.by === "claude" ? "Claude" : "reglas"}</span>
                </>
              ) : (
                `Responde con el estado del recinto en este minuto${s.copilotAI ? " (Claude)" : ""}.`
              )}
            </p>
          </div>
        </div>

        {/* Ingreso y barras */}
        <div className="grid border-t border-line lg:grid-cols-[1.4fr_1fr]">
          <div className="bg-surface px-4 py-4 lg:border-r lg:border-line">
            <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-muted">Ingreso: escaneos reales contra llegadas esperadas</p>
            <IngressChart s={s} />
          </div>
          <div className="bg-surface px-4 py-4">
            <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-muted">Barras</p>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-ink text-left text-[10px] uppercase tracking-[0.12em] text-muted">
                  <th className="py-1.5 font-normal">Barra</th>
                  <th className="py-1.5 text-right font-normal">Fila</th>
                  <th className="py-1.5 text-right font-normal">Cajas</th>
                  <th className="py-1.5 text-right font-normal">Ventas</th>
                </tr>
              </thead>
              <tbody>
                {s.bars.map((b) => {
                  const hot = (b.queueMin ?? 0) >= 8;
                  return (
                    <tr key={b.id} className="border-b border-line">
                      <td className="py-1.5">{b.name}</td>
                      <td className="tabular py-1.5 text-right" style={{ color: hot ? "var(--signal)" : undefined }}>
                        {b.queueMin === null ? "—" : `${b.queueMin.toFixed(1)}′`}
                      </td>
                      <td className="tabular py-1.5 text-right">{b.registers}</td>
                      <td className="tabular py-1.5 text-right">{money(b.salesTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-muted">
        {s.source === "sim"
          ? "Simulador: datos sintéticos de un estadio de ejemplo. Para datos reales, cambia la fuente en Configuración y envía eventos a /api/ingest."
          : "En vivo: escaneos, ventas y sensores recibidos en /api/ingest."}{" "}
        Almacenamiento: {s.storage === "redis" ? "Redis (persistente)" : "memoria (se reinicia con el servidor)"}.
      </p>

      {toast && (
        <div role="status" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 border border-ink bg-surface px-4 py-2 text-sm shadow-lg">
          {toast}
        </div>
      )}
    </main>
  );
}

function phaseLabel(s: ConsoleState) {
  const now = Math.floor(s.minute);
  if (s.phase === "antes") return `Faltan ${-now} min para abrir`;
  if (s.phase === "ingreso") return `Ingreso · show en ${s.showMinute - now} min`;
  if (s.phase === "show") return "Show en curso";
  return "Cierre";
}

function actionStatusText(a: Action, doorsOpen: string) {
  if (a.status === "pending") return "⧗ Espera aprobación";
  if (a.status === "dismissed") return "Descartada";
  const when = a.decidedMinute !== undefined ? ` · ${clockFrom(doorsOpen, a.decidedMinute)}` : "";
  return a.status === "auto" ? `✓ Ejecutada por el copiloto${when}` : `✓ Aprobada${when}`;
}

function ActionRow({ a, doorsOpen, busy, onDecide }: { a: Action; doorsOpen: string; busy: string | null; onDecide: (d: "approve" | "dismiss") => void }) {
  return (
    <li className="flex flex-wrap items-start gap-3 border border-ink bg-surface px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-[0.12em] text-muted">
          {clockFrom(doorsOpen, a.minute)} · {AREA_LABEL[a.area]}
        </p>
        <p className="text-sm font-semibold">{a.text}</p>
        <p className="text-xs text-ink-2">{a.why}</p>
      </div>
      <div className="flex gap-2 text-[11px] uppercase tracking-[0.12em]">
        <button type="button" disabled={busy !== null} onClick={() => onDecide("approve")} className="bg-ink px-3 py-1.5 text-surface disabled:opacity-50">
          Aprobar
        </button>
        <button type="button" disabled={busy !== null} onClick={() => onDecide("dismiss")} className="border border-ink px-3 py-1.5 disabled:opacity-50">
          Descartar
        </button>
      </div>
    </li>
  );
}

function StatusPill({ status }: { status: Status }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className="mt-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em]" style={{ color: status === "good" ? "var(--ink-2)" : STATUS_COLOR[status] }}>
      <Icon className="h-3 w-3" aria-hidden /> {STATUS_LABEL[status]}
    </span>
  );
}

function Spark({ values }: { values: number[] }) {
  const w = 120;
  const h = 28;
  if (values.length < 2) return <div className="h-7" />;
  const max = Math.max(1, ...values);
  const d = values.map((v, i) => `${i ? "L" : "M"}${(i / (values.length - 1)) * w},${h - (v / max) * (h - 2)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-7 w-full" aria-hidden>
      <path d={d} fill="none" stroke="var(--ink)" strokeWidth="1.2" />
    </svg>
  );
}

function Timeline({ s, onSeek }: { s: ConsoleState; onSeek?: (m: number) => void }) {
  const now = Math.max(0, Math.min(s.totalMinutes - 1, Math.floor(s.minute)));
  const pct = (m: number) => `${(m / (s.totalMinutes - 1)) * 100}%`;
  return (
    <div className="relative border-b border-line bg-surface px-4 pb-3 pt-5">
      <div className="relative h-6">
        <div className="absolute inset-x-0 top-3 h-px bg-ink" />
        <div className="absolute top-3 h-0.5 bg-signal" style={{ width: pct(now) }} />
        {s.feed
          .filter((e) => e.severity && e.severity !== "good")
          .map((e) => (
            <span key={e.id} aria-hidden className="absolute top-1 h-4 w-px" style={{ left: pct(e.minute), background: STATUS_COLOR[e.severity!] }} />
          ))}
        <span aria-hidden className="absolute top-0 h-6 w-px bg-ink" style={{ left: pct(s.showMinute) }} />
        <span className="absolute top-0 h-6 w-0.5 bg-ink" style={{ left: pct(now) }} />
      </div>
      {onSeek && (
        <input
          type="range"
          min={0}
          max={s.totalMinutes - 1}
          defaultValue={now}
          key={Math.round(now / 5)}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="absolute inset-x-4 top-4 h-6 cursor-pointer opacity-0"
          aria-label="Ir a otro minuto del evento"
        />
      )}
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>{s.event.doorsOpen} · apertura</span>
        <span>{s.event.showStart} · show</span>
      </div>
    </div>
  );
}

function IngressChart({ s }: { s: ConsoleState }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const height = 170;
  const pad = { l: 36, r: 12, t: 10, b: 24 };
  const w = Math.max(width, 280);
  const T = s.totalMinutes;
  const peak = Math.max(10, ...s.series.scans, ...s.series.expected);
  const step = Math.pow(10, Math.floor(Math.log10(peak)));
  const max = Math.ceil(peak / step) * step;
  const x = (m: number) => pad.l + (m / (T - 1)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b);
  const path = (arr: number[]) => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const ticks = [0, Math.round(T / 4), Math.round(T / 2), Math.round((3 * T) / 4), T - 1];
  return (
    <div ref={ref}>
      <ul className="mb-2 flex flex-wrap gap-4 text-[11px] text-ink-2">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 bg-ink" /> Escaneos por minuto
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4" style={{ background: "var(--series-muted)" }} /> Llegadas esperadas
        </li>
      </ul>
      <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} role="img" aria-label="Escaneos por minuto contra llegadas esperadas">
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--baseline)" : "var(--grid)"} />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="var(--muted)">
              {Math.round(t)}
            </text>
          </g>
        ))}
        {ticks.map((m, i) => (
          <text key={m} x={x(m)} y={height - 6} textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"} fontSize="9" fill="var(--muted)">
            {clockFrom(s.event.doorsOpen, m)}
          </text>
        ))}
        <path d={path(s.series.expected)} fill="none" stroke="var(--series-muted)" strokeWidth="2" />
        <path d={path(s.series.scans)} fill="none" stroke="var(--ink)" strokeWidth="1.6" strokeLinejoin="round" />
        <line x1={x(s.showMinute)} x2={x(s.showMinute)} y1={pad.t} y2={height - pad.b} stroke="var(--ink)" strokeDasharray="3 3" opacity="0.5" />
      </svg>
    </div>
  );
}
