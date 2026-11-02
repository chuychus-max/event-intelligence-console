import { json, loadConfig, safeEqual } from "@/lib/server";
import { getStore } from "@/lib/store";
import { eventWindow, minuteOf } from "@/lib/time";
import type { Area, FeedEvent, Status } from "@/lib/types";

export const dynamic = "force-dynamic";

// Entrada de datos reales. Autenticación: header `x-api-key` = INGEST_API_KEY.
//
// Cuerpo: un evento o { events: [...] } (hasta 5,000). Tipos:
//   { type: "scan",      gate: "C", count?: 1,          ts? }
//   { type: "sale",      bar: "4",  amount: 250, count?: 1, ts? }
//   { type: "queue",     gate: "C", people: 420,        ts? }   sensor de fila
//   { type: "bar_queue", bar: "4",  minutes: 9,         ts? }
//   { type: "density",   value: 3.2,                    ts? }   personas/m² en pista
//   { type: "alert",     area: "SEG", text: "...", severity?, at?, ts? }
// ts: ISO 8601 o milisegundos; si falta, se usa la hora de llegada.

type In = Record<string, unknown>;
const AREAS: Area[] = ["OPS", "SEG", "AYB", "COM", "PC", "FAN"];
const SEVERITIES: Status[] = ["good", "warning", "serious", "critical"];

export async function POST(req: Request) {
  const key = process.env.INGEST_API_KEY;
  if (!key) return json({ error: "Ingesta deshabilitada: define INGEST_API_KEY en el proyecto" }, 503);
  if (!safeEqual(req.headers.get("x-api-key") ?? "", key)) return json({ error: "x-api-key inválida" }, 401);

  const body = (await req.json().catch(() => null)) as In | { events?: In[] } | null;
  if (!body) return json({ error: "JSON inválido" }, 400);
  const events: In[] = Array.isArray((body as { events?: In[] }).events) ? (body as { events: In[] }).events : [body as In];
  if (events.length > 5000) return json({ error: "Máximo 5,000 eventos por petición" }, 413);

  const store = getStore();
  const cfg = await loadConfig(store);
  const { totalMinutes } = eventWindow(cfg);
  const gates = new Set(cfg.gates.map((g) => g.id));
  const bars = new Set(cfg.bars.map((b) => b.id));
  const now = Date.now();

  const scans: { m: number; gate: string; n: number }[] = [];
  const sales: { m: number; bar: string; amount: number; tx: number }[] = [];
  const obs: { key: string; value: number }[] = [];
  const alerts: FeedEvent[] = [];
  const rejected: { index: number; reason: string }[] = [];

  events.forEach((e, index) => {
    const reject = (reason: string) => rejected.push({ index, reason });
    const ts = typeof e.ts === "number" ? e.ts : typeof e.ts === "string" ? Date.parse(e.ts) : now;
    if (!Number.isFinite(ts)) return reject("ts inválido");
    const m = minuteOf(cfg, ts);
    if (m < 0 || m >= totalMinutes) return reject(`fuera de la ventana del evento (minuto ${m})`);
    const n = (v: unknown, d?: number) => (v === undefined && d !== undefined ? d : typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : NaN);
    switch (e.type) {
      case "scan": {
        const c = n(e.count, 1);
        if (!gates.has(String(e.gate)) || Number.isNaN(c)) return reject("scan: gate o count inválido");
        scans.push({ m, gate: String(e.gate), n: c });
        break;
      }
      case "sale": {
        const a = n(e.amount);
        const c = n(e.count, 1);
        if (!bars.has(String(e.bar)) || Number.isNaN(a) || Number.isNaN(c)) return reject("sale: bar, amount o count inválido");
        sales.push({ m, bar: String(e.bar), amount: a, tx: c });
        break;
      }
      case "queue": {
        const p = n(e.people);
        if (!gates.has(String(e.gate)) || Number.isNaN(p)) return reject("queue: gate o people inválido");
        obs.push({ key: `queue:${e.gate}:${m}`, value: p });
        break;
      }
      case "bar_queue": {
        const v = n(e.minutes);
        if (!bars.has(String(e.bar)) || Number.isNaN(v)) return reject("bar_queue: bar o minutes inválido");
        obs.push({ key: `barq:${e.bar}:${m}`, value: v });
        break;
      }
      case "density": {
        const v = n(e.value);
        if (Number.isNaN(v) || v > 12) return reject("density: value inválido (0–12 p/m²)");
        obs.push({ key: `density:${m}`, value: v });
        break;
      }
      case "alert": {
        const area = String(e.area) as Area;
        const text = typeof e.text === "string" ? e.text.trim().slice(0, 280) : "";
        if (!AREAS.includes(area) || !text) return reject("alert: area (OPS|SEG|AYB|COM|PC|FAN) y text requeridos");
        const severity = SEVERITIES.includes(e.severity as Status) ? (e.severity as Status) : undefined;
        const at = typeof e.at === "string" && /^(gate:[A-H]|bar:[1-6]|spot:[1-5]|pista|escenario)$/.test(e.at) ? e.at : undefined;
        alerts.push({ id: `in-${ts}-${index}-${Math.random().toString(36).slice(2, 7)}`, minute: m, area, kind: severity && severity !== "good" ? "alerta" : "aviso", text, severity, at });
        break;
      }
      default:
        reject("type: scan | sale | queue | bar_queue | density | alert");
    }
  });

  await Promise.all([store.addScans(scans), store.addSales(sales), store.setObs(obs), ...alerts.map((a) => store.addAlert(a))]);
  return json({
    accepted: events.length - rejected.length,
    rejected,
    ...(cfg.source !== "live" && rejected.length < events.length ? { warning: "Datos guardados, pero la consola está en modo simulador. Cambia la fuente a 'live' en /configuracion para verlos." } : {}),
  });
}
