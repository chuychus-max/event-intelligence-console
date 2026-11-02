import type { EventConfig } from "./types";

// Configuración de arranque: estadio de 60,000 personas, 8 accesos y 6 barras.
// Todo se edita desde /configuracion; las letras A–H y las barras 1–6 coinciden
// con la maqueta 3D.
export function defaultConfig(now = Date.now()): EventConfig {
  return {
    name: "Concierto · noche 1",
    venue: "Estadio (ejemplo)",
    date: new Date(now).toISOString().slice(0, 10),
    timezone: "America/Mexico_City",
    doorsOpen: "16:00",
    showStart: "20:30",
    capacity: 60000,
    ticketsSold: 58000,
    scanRatePerLane: 8,
    gates: [
      { id: "A", name: "Puerta A", share: 0.12, lanes: 9, lanesMax: 14 },
      { id: "B", name: "Puerta B", share: 0.11, lanes: 9, lanesMax: 14 },
      { id: "C", name: "Puerta C", share: 0.17, lanes: 7, lanesMax: 12 },
      { id: "D", name: "Puerta D", share: 0.12, lanes: 9, lanesMax: 14 },
      { id: "E", name: "Puerta E", share: 0.12, lanes: 8, lanesMax: 12 },
      { id: "F", name: "Puerta F", share: 0.12, lanes: 9, lanesMax: 14 },
      { id: "G", name: "Puerta G", share: 0.12, lanes: 9, lanesMax: 14 },
      { id: "H", name: "Puerta H", share: 0.12, lanes: 9, lanesMax: 14 },
    ],
    bars: [
      { id: "1", name: "Barra 1 · Poniente", registers: 18 },
      { id: "2", name: "Barra 2 · Sur poniente", registers: 18 },
      { id: "3", name: "Barra 3 · Sur oriente", registers: 18 },
      { id: "4", name: "Barra 4 · Oriente", registers: 14 },
      { id: "5", name: "Barra 5 · Norponiente", registers: 16 },
      { id: "6", name: "Barra 6 · Nororiente", registers: 16 },
    ],
    thresholds: { warning: 5, serious: 12, critical: 20 },
    barQueueAlert: 8,
    densityAlert: 4,
    autopilot: true,
    source: "sim",
    sim: { speed: 10, startedAt: now, offset: 150, seed: 2026 },
  };
}

// Valida y completa una configuración recibida por la API.
export function sanitizeConfig(input: Partial<EventConfig>, base: EventConfig): EventConfig {
  const num = (v: unknown, d: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
  };
  const hhmm = (v: unknown, d: string) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : d);
  const str = (v: unknown, d: string, max = 80) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : d);
  const gates = base.gates.map((g) => {
    const x = input.gates?.find((y) => y.id === g.id);
    if (!x) return g;
    const lanes = num(x.lanes, g.lanes, 1, 60);
    return { id: g.id, name: str(x.name, g.name, 40), share: num(x.share, g.share, 0, 1), lanes, lanesMax: Math.max(lanes, num(x.lanesMax, g.lanesMax, 1, 80)) };
  });
  const shareSum = gates.reduce((a, g) => a + g.share, 0) || 1;
  const bars = base.bars.map((b) => {
    const x = input.bars?.find((y) => y.id === b.id);
    return x ? { id: b.id, name: str(x.name, b.name, 40), registers: num(x.registers, b.registers, 1, 30) } : b;
  });
  const t = input.thresholds ?? base.thresholds;
  const warning = num(t.warning, base.thresholds.warning, 1, 60);
  const serious = Math.max(warning + 1, num(t.serious, base.thresholds.serious, 2, 90));
  const critical = Math.max(serious + 1, num(t.critical, base.thresholds.critical, 3, 120));
  const doorsOpen = hhmm(input.doorsOpen, base.doorsOpen);
  let showStart = hhmm(input.showStart, base.showStart);
  if (toMin(showStart) - toMin(doorsOpen) < 30) showStart = base.showStart;
  const capacity = num(input.capacity, base.capacity, 100, 300000);
  return {
    name: str(input.name, base.name),
    venue: str(input.venue, base.venue),
    date: typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : base.date,
    timezone: typeof input.timezone === "string" && validTz(input.timezone) ? input.timezone : base.timezone,
    doorsOpen,
    showStart,
    capacity,
    ticketsSold: num(input.ticketsSold, base.ticketsSold, 0, capacity),
    scanRatePerLane: num(input.scanRatePerLane, base.scanRatePerLane, 1, 40),
    gates: gates.map((g) => ({ ...g, share: g.share / shareSum })),
    bars,
    thresholds: { warning, serious, critical },
    barQueueAlert: num(input.barQueueAlert, base.barQueueAlert, 1, 60),
    densityAlert: num(input.densityAlert, base.densityAlert, 1, 9),
    autopilot: typeof input.autopilot === "boolean" ? input.autopilot : base.autopilot,
    source: input.source === "live" || input.source === "sim" ? input.source : base.source,
    sim: base.sim,
  };
}

export function toMin(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function validTz(tz: string) {
  try {
    new Intl.DateTimeFormat("es-MX", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
