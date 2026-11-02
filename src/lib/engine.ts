// Motor de Event Intelligence. Reconstruye el evento minuto a minuto desde la
// apertura de puertas hasta "ahora" con los datos disponibles:
//
//   escaneos por puerta  → personas que pasaron (dato del boletaje)
//   sensores de fila     → personas formadas (cámara/LiDAR), opcional
//   pagos por barra      → ventas y transacciones (POS / adquirente)
//   fila en barra        → minutos (sensor u operador), opcional
//   densidad en pista    → personas/m², opcional
//   alertas              → texto libre de cualquier área
//
// Si no hay sensor de fila, la fila se estima: llegadas esperadas (boletos ×
// curva de llegada × reparto por puerta) menos escaneos. Espera = fila /
// (carriles × escaneos por carril por minuto).
//
// Las reglas del copiloto proponen acciones; las aprobadas (o las automáticas)
// cambian la operación desde su minuto: más carriles, desvío de fans, más
// cajas, válvula de alivio. Todo es determinista: la misma entrada da el mismo
// resultado en cada petición, sin procesos en segundo plano.

import type { EventData } from "./store";
import { clockAt, eventWindow } from "./time";
import type { Action, Area, BarView, ConsoleState, Decision, EventConfig, FeedEvent, GateView, Status } from "./types";

export interface EngineInput {
  cfg: EventConfig;
  minute: number;
  running: boolean;
  data: EventData;
  decisions: Record<string, Decision>;
  storage: "memoria" | "redis";
  ingestEnabled: boolean;
  copilotAI: boolean;
  now?: number;
}

export interface ReportData {
  minutes: number;
  waitsByGate: Record<string, number[]>;
  queueTotal: number[];
  // espera de cada puerta en cada minuto, ponderada por las personas que pasaron
  waitSamples: [number, number][];
}

interface Effects {
  extraLanes: Record<string, number>;
  redirect: Record<string, { to: string; frac: number }>;
  extraRegisters: Record<string, number>;
  valve: boolean;
}

interface StepOut {
  served: Record<string, number>;
  queueObs: Record<string, number | undefined>;
  sales: Record<string, { amount: number; tx: number }>;
  barQueue: Record<string, number | undefined>;
  density?: number;
  alerts: FeedEvent[];
}

interface MinuteSource {
  step(m: number, fx: Effects, lanes: Record<string, number>, registers: Record<string, number>): StepOut;
}

const REDIRECT_FRAC = 0.3;
const EXTRA_REGISTERS = 4;
const TX_PER_REGISTER = 3; // transacciones por caja por minuto
const AVG_TICKET = 165; // pesos por transacción (simulador)

// ─── Curva de llegada esperada ─────────────────────────────────────────────

export function expectedArrivals(cfg: EventConfig): number[] {
  const { showMinute: S, totalMinutes } = eventWindow(cfg);
  const raw: number[] = [];
  for (let m = 0; m < totalMinutes; m++) {
    const toShow = S - m;
    const early = 0.25 * Math.exp(-((m - 60) ** 2) / (2 * 50 ** 2));
    const peak = 1.6 * Math.exp(-((toShow - 25) ** 2) / (2 * 30 ** 2));
    const ramp = 0.35 * Math.min(1, m / 120);
    // después del inicio del show sólo llegan rezagados, cada vez menos
    const tail = m > S ? Math.exp(-(m - S) / 6) : 1;
    raw.push((early + peak + ramp) * tail);
  }
  const total = raw.reduce((a, b) => a + b, 0) || 1;
  const attending = cfg.ticketsSold * 0.97;
  return raw.map((v) => (v / total) * attending);
}

export function statusFor(cfg: EventConfig, wait: number): Status {
  const t = cfg.thresholds;
  if (wait < t.warning) return "good";
  if (wait < t.serious) return "warning";
  if (wait < t.critical) return "serious";
  return "critical";
}

// ─── Fuente: datos reales guardados ────────────────────────────────────────

function liveSource(cfg: EventConfig, data: EventData): MinuteSource {
  const alertsByMinute = new Map<number, FeedEvent[]>();
  for (const a of data.alerts) {
    const list = alertsByMinute.get(a.minute) ?? [];
    list.push(a);
    alertsByMinute.set(a.minute, list);
  }
  return {
    step(m) {
      const served: Record<string, number> = {};
      const queueObs: Record<string, number | undefined> = {};
      for (const g of cfg.gates) {
        served[g.id] = data.scans[`${m}:${g.id}`] ?? 0;
        queueObs[g.id] = data.obs[`queue:${g.id}:${m}`];
      }
      const sales: Record<string, { amount: number; tx: number }> = {};
      const barQueue: Record<string, number | undefined> = {};
      for (const b of cfg.bars) {
        sales[b.id] = { amount: data.sales[`${m}:${b.id}`] ?? 0, tx: data.tx[`${m}:${b.id}`] ?? 0 };
        barQueue[b.id] = data.obs[`barq:${b.id}:${m}`];
      }
      return { served, queueObs, sales, barQueue, density: data.obs[`density:${m}`], alerts: alertsByMinute.get(m) ?? [] };
    },
  };
}

// ─── Fuente: simulador ─────────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simScript(cfg: EventConfig): FeedEvent[] {
  const { showMinute: S } = eventWindow(cfg);
  const lanes = cfg.gates.reduce((a, g) => a + g.lanes, 0);
  const e = (minute: number, area: Area, kind: FeedEvent["kind"], text: string, extra: Partial<FeedEvent> = {}): FeedEvent => ({
    id: `sim-${minute}-${area}-${kind}`,
    minute,
    area,
    kind,
    text,
    ...extra,
  });
  return [
    e(0, "OPS", "aviso", `Apertura de puertas · ${cfg.gates.length} accesos, ${lanes} carriles activos`),
    e(5, "PC", "dato", "Checklist previo firmado: 3 de 4 controles"),
    e(20, "PC", "resuelto", "Inspección de gradas temporales firmada · foto y responsable"),
    e(70, "COM", "dato", "Spot 1 · Explanada supera 5,000 personas/h", { at: "spot:1" }),
    e(90, "OPS", "aviso", `Pronóstico: pico de llegadas hacia las ${clockAt(cfg, S - 25)} (±10 min)`),
    e(120, "FAN", "aviso", `Recordatorio enviado: puerta y hora sugerida · ${cfg.ticketsSold.toLocaleString("es-MX")} boletos`),
    e(165, "PC", "resuelto", "Prueba de radio con brigadas · 12 de 12 responden"),
    e(170, "COM", "dato", "Spot 4 · Barra principal: conversión 11.8%, máximo del día", { at: "spot:4" }),
    e(185, "OPS", "alerta", "Puerta E · lector del carril 3 falla (reporte por WhatsApp) → técnico enviado", { at: "gate:E", severity: "warning" }),
    e(188, "SEG", "resuelto", "Acceso B · objeto olvidado revisado y liberado", { at: "gate:B" }),
    e(205, "FAN", "dato", "320 consultas al bot en 10 min: “¿cuál es mi puerta?”"),
    e(215, "COM", "dato", "Spot 2 · Concourse sur: permanencia sube a 3.1 min", { at: "spot:2" }),
    e(S - 42, "SEG", "alerta", "Acceso G · 14 boletos duplicados bloqueados", { at: "gate:G", severity: "warning" }),
    e(S - 30, "COM", "dato", "Pantallas del concourse · 41,000 impresiones acumuladas"),
    e(S - 5, "COM", "aviso", "Reporte de patrocinadores listo para el cierre"),
    e(S + 10, "PC", "dato", "Pasillos de gradas despejados · bitácora actualizada"),
  ].filter((x) => x.minute >= 0);
}

function simSource(cfg: EventConfig, expected: number[]): MinuteSource {
  const { showMinute: S } = eventWindow(cfg);
  const rand = mulberry32(cfg.sim.seed);
  const queue: Record<string, number> = Object.fromEntries(cfg.gates.map((g) => [g.id, 0]));
  const barBacklog: Record<string, number> = Object.fromEntries(cfg.bars.map((b) => [b.id, 0]));
  const barWeight = [1, 1, 1, 1.35, 0.9, 0.9];
  const script = new Map<number, FeedEvent[]>();
  for (const e of simScript(cfg)) script.set(e.minute, [...(script.get(e.minute) ?? []), e]);
  let inside = 0;

  return {
    step(m, fx, lanes, registers) {
      // Siempre el mismo número de llamadas a rand() por minuto: así el resto
      // del evento no cambia cuando una acción cambia la operación.
      const noise = 0.85 + rand() * 0.3;
      const surge = m > S - 60 && m < S - 35 ? 1.18 : 1;
      const total = (expected[m] ?? 0) * noise * surge;
      const arrivals: Record<string, number> = {};
      for (const g of cfg.gates) arrivals[g.id] = total * g.share;
      for (const [from, r] of Object.entries(fx.redirect)) {
        const moved = arrivals[from] * r.frac;
        arrivals[from] -= moved;
        arrivals[r.to] = (arrivals[r.to] ?? 0) + moved;
      }
      const served: Record<string, number> = {};
      const queueObs: Record<string, number | undefined> = {};
      for (const g of cfg.gates) {
        const cap = lanes[g.id] * cfg.scanRatePerLane * (0.95 + rand() * 0.1);
        const backlog = queue[g.id] + arrivals[g.id];
        served[g.id] = Math.min(backlog, cap);
        queue[g.id] = backlog - served[g.id];
        queueObs[g.id] = Math.max(0, queue[g.id] * (0.96 + rand() * 0.08));
        inside += served[g.id];
      }
      const sales: Record<string, { amount: number; tx: number }> = {};
      const barQueue: Record<string, number | undefined> = {};
      const showFactor = m > S ? 0.5 : 1;
      cfg.bars.forEach((b, i) => {
        const demand = inside * 0.0011 * (barWeight[i] ?? 1) * showFactor * (0.9 + rand() * 0.2);
        const cap = registers[b.id] * TX_PER_REGISTER;
        const backlog = barBacklog[b.id] + demand;
        const tx = Math.min(backlog, cap);
        barBacklog[b.id] = backlog - tx;
        sales[b.id] = { amount: tx * AVG_TICKET * (0.92 + rand() * 0.16), tx };
        barQueue[b.id] = barBacklog[b.id] / Math.max(1, cap);
      });
      const fill = inside / Math.max(1, cfg.capacity);
      const density = (0.6 + 3.9 * Math.pow(fill, 1.6) * (m > S - 40 ? 1 : 0.85)) * (fx.valve ? 0.78 : 1) + (rand() - 0.5) * 0.15;
      return { served, queueObs, sales, barQueue, density, alerts: script.get(m) ?? [] };
    },
  };
}

// ─── Motor ─────────────────────────────────────────────────────────────────

export function compute(input: EngineInput): { state: ConsoleState; report: ReportData } {
  const { cfg, decisions } = input;
  const { showMinute, totalMinutes } = eventWindow(cfg);
  const now = Math.floor(input.minute);
  const last = Math.min(now, totalMinutes - 1);
  const expected = expectedArrivals(cfg);
  const src = cfg.source === "sim" ? simSource(cfg, expected) : liveSource(cfg, input.data);
  const rate = cfg.scanRatePerLane;

  const fx: Effects = { extraLanes: {}, redirect: {}, extraRegisters: {}, valve: false };
  const lanesNow = () => Object.fromEntries(cfg.gates.map((g) => [g.id, Math.min(g.lanesMax, g.lanes + (fx.extraLanes[g.id] ?? 0))]));
  const registersNow = () => Object.fromEntries(cfg.bars.map((b) => [b.id, b.registers + (fx.extraRegisters[b.id] ?? 0)]));
  const shareNow = (id: string) => {
    const g = cfg.gates.find((x) => x.id === id)!;
    let s = g.share * (fx.redirect[id] ? 1 - fx.redirect[id].frac : 1);
    for (const [from, r] of Object.entries(fx.redirect)) if (r.to === id) s += cfg.gates.find((x) => x.id === from)!.share * r.frac;
    return s;
  };

  const feed: FeedEvent[] = [];
  const actions: (Action & { effect: () => string[]; applied: boolean; approvedMinute?: number; gate?: string; bar?: string; kind2: string })[] = [];
  const q: Record<string, number> = Object.fromEntries(cfg.gates.map((g) => [g.id, 0]));
  const qSrc: Record<string, GateView["queueSource"]> = Object.fromEntries(cfg.gates.map((g) => [g.id, cfg.source === "live" ? "sin datos" : "estimado"]));
  // En vivo, una puerta sin ningún escaneo ni sensor no se estima: puede estar
  // cerrada o sin conexión, y una fila inventada dispararía acciones falsas.
  const hasData: Record<string, boolean> = Object.fromEntries(cfg.gates.map((g) => [g.id, cfg.source !== "live"]));
  const lastStatus: Record<string, Status> = {};
  const calib: Record<string, { a: number[]; e: number[] }> = Object.fromEntries(cfg.gates.map((g) => [g.id, { a: [], e: [] }]));
  const k = (id: string) => {
    const c = calib[id];
    const sa = c.a.reduce((x, y) => x + y, 0);
    const se = c.e.reduce((x, y) => x + y, 0);
    return se > 40 ? Math.min(2, Math.max(0.5, sa / se)) : 1;
  };
  const report: ReportData = { minutes: 0, waitsByGate: Object.fromEntries(cfg.gates.map((g) => [g.id, []])), queueTotal: [], waitSamples: [] };

  let inside = 0;
  let milestone = 10000;
  const fillMarks = [0.5, 0.9, 0.97];
  const scansSeries: number[] = [];
  const insideSeries: number[] = [];
  const bars = Object.fromEntries(cfg.bars.map((b) => [b.id, { salesTotal: 0, tx: 0, queueMin: null as number | null, lastSales: [] as number[], lastTx: [] as number[] }]));
  let density: number | null = null;
  let lastServed: Record<string, number> = {};
  let lastArr: Record<string, number> = {};
  const noSalesFlag: Record<string, number> = {};

  const decide = (a: (typeof actions)[number]) => {
    const d = decisions[a.id];
    if (d?.decision === "dismiss") return { status: "dismissed" as const, minute: Math.max(a.minute, d.minute) };
    if (d?.decision === "approve") return { status: "approved" as const, minute: Math.max(a.minute + 1, d.minute) };
    if (cfg.autopilot) return { status: "auto" as const, minute: a.minute + 1 };
    return { status: "pending" as const, minute: undefined };
  };

  const forecastMax = (id: string, m: number, lanes: number) => {
    let qf = q[id];
    let worst = qf / (lanes * rate);
    const kk = k(id);
    const share = shareNow(id);
    for (let t = 1; t <= 30 && m + t < totalMinutes; t++) {
      qf = Math.max(0, qf + (expected[m + t] ?? 0) * share * kk - lanes * rate);
      worst = Math.max(worst, qf / (lanes * rate));
    }
    return worst;
  };

  const openFor = (key: string, m: number) =>
    actions.some((a) => {
      if (a.kind2 !== key) return false;
      const d = decide(a);
      if (d.status === "pending") return true;
      if (d.status === "dismissed") return m - (d.minute ?? a.minute) < 15;
      return m - (d.minute ?? a.minute) < 20;
    });

  for (let m = 0; m <= last; m++) {
    // 1. Acciones aprobadas que entran en vigor este minuto
    for (const a of actions) {
      if (a.applied) continue;
      const d = decide(a);
      if ((d.status === "approved" || d.status === "auto") && d.minute !== undefined && d.minute <= m) {
        a.applied = true;
        a.approvedMinute = d.minute;
        a.effect().forEach((text, i) =>
          feed.push({ id: `${a.id}-done-${i}`, minute: m, area: i === 0 ? a.area : "FAN", kind: "resuelto", text, at: a.at }),
        );
      }
    }

    // 2. Datos del minuto
    const lanes = lanesNow();
    const out = src.step(m, fx, lanes, registersNow());
    for (const al of out.alerts) feed.push(al);

    // 3. Puertas
    let scans = 0;
    const waits: Record<string, number> = {};
    for (const g of cfg.gates) {
      const served = out.served[g.id] ?? 0;
      scans += served;
      const exp = (expected[m] ?? 0) * shareNow(g.id);
      const prev = q[g.id];
      const obs = out.queueObs[g.id];
      if (served > 0 || obs !== undefined) hasData[g.id] = true;
      if (!hasData[g.id]) {
        q[g.id] = 0;
      } else if (obs !== undefined) {
        q[g.id] = obs;
        qSrc[g.id] = "sensor";
        const arr = Math.max(0, served + obs - prev);
        calib[g.id].a.push(arr);
        calib[g.id].e.push(exp);
        if (calib[g.id].a.length > 20) {
          calib[g.id].a.shift();
          calib[g.id].e.shift();
        }
      } else {
        q[g.id] = Math.max(0, prev + exp * k(g.id) - served);
        qSrc[g.id] = "estimado";
      }
      lastArr[g.id] = Math.max(0, served + q[g.id] - prev);
      lastServed[g.id] = served;
      const wait = q[g.id] / (lanes[g.id] * rate);
      waits[g.id] = wait;
      report.waitsByGate[g.id].push(wait);
      if (served > 0) report.waitSamples.push([wait, served]);
      const st = statusFor(cfg, wait);
      const before = lastStatus[g.id] ?? "good";
      if (st !== before) {
        feed.push({
          id: `gate-${g.id}-${m}`,
          minute: m,
          area: "OPS",
          kind: st === "good" ? "resuelto" : "alerta",
          severity: st,
          at: `gate:${g.id}`,
          text: st === "good" ? `${g.name} vuelve a fluir` : `${g.name} · espera ${wait.toFixed(1)} min (${statusText(st)})`,
        });
      }
      lastStatus[g.id] = st;
    }
    inside += scans;
    scansSeries.push(scans);
    insideSeries.push(inside);
    report.queueTotal.push(Object.values(q).reduce((a, b) => a + b, 0));
    while (inside >= milestone && milestone <= cfg.capacity) {
      feed.push({ id: `ms-${milestone}`, minute: m, area: "OPS", kind: "dato", text: `${milestone.toLocaleString("es-MX")} personas dentro del recinto` });
      milestone += 10000;
    }
    while (fillMarks.length && inside >= fillMarks[0] * cfg.capacity) {
      const f = fillMarks.shift()!;
      feed.push({ id: `pc-${f}`, minute: m, area: "PC", kind: "dato", text: `Aforo ${Math.round(f * 100)}% · ${Math.round(inside).toLocaleString("es-MX")} personas · rutas de evacuación libres` });
    }

    // 4. Barras y densidad
    for (const b of cfg.bars) {
      const s = out.sales[b.id] ?? { amount: 0, tx: 0 };
      const st = bars[b.id];
      st.salesTotal += s.amount;
      st.tx += s.tx;
      st.lastSales.push(s.amount);
      st.lastTx.push(s.tx);
      if (st.lastSales.length > 10) {
        st.lastSales.shift();
        st.lastTx.shift();
      }
      if (out.barQueue[b.id] !== undefined) st.queueMin = out.barQueue[b.id]!;
    }
    if (out.density !== undefined) density = out.density;

    // 5. Reglas del copiloto
    if (m < showMinute + 15) {
      for (const g of cfg.gates) {
        const key = `gate-${g.id}`;
        if (!hasData[g.id] || openFor(key, m)) continue;
        const peak = forecastMax(g.id, m, lanes[g.id]);
        if (Math.max(waits[g.id], peak) < cfg.thresholds.serious) continue;
        let extra = 0;
        for (let x = 1; x <= g.lanesMax - lanes[g.id]; x++) {
          if (forecastMax(g.id, m, lanes[g.id] + x) < cfg.thresholds.warning) {
            extra = x;
            break;
          }
        }
        if (!extra && g.lanesMax > lanes[g.id]) extra = g.lanesMax - lanes[g.id];
        const peakAt = clockAt(cfg, Math.min(m + 30, totalMinutes - 1));
        if (extra > 0) {
          const id = `${cfg.source}-lanes-${g.id}-${m}`;
          const n = extra;
          const gid = g.id;
          actions.push({
            id,
            kind2: key,
            minute: m,
            area: "OPS",
            at: `gate:${g.id}`,
            gate: g.id,
            text: `${g.name} · abrir +${n} carriles`,
            why: `Espera actual ${waits[g.id].toFixed(1)} min; pronóstico hasta ${Math.round(peak)} min antes de las ${peakAt}. Con +${n} carriles queda por debajo de ${cfg.thresholds.warning} min.`,
            status: "pending",
            applied: false,
            effect: () => {
              fx.extraLanes[gid] = (fx.extraLanes[gid] ?? 0) + n;
              return [`+${n} carriles abiertos en ${g.name} · ${lanesNow()[gid]} en total`];
            },
          });
        } else {
          const target = [...cfg.gates]
            .filter((x) => x.id !== g.id && !fx.redirect[x.id] && waits[x.id] < cfg.thresholds.warning)
            .sort((a, b) => waits[a.id] - waits[b.id])[0];
          if (!target || fx.redirect[g.id]) continue;
          const id = `${cfg.source}-redirect-${g.id}-${m}`;
          const gid = g.id;
          const fans = Math.round(cfg.ticketsSold * g.share * REDIRECT_FRAC * 0.25);
          actions.push({
            id,
            kind2: key,
            minute: m,
            area: "FAN",
            at: `gate:${g.id}`,
            gate: g.id,
            text: `${g.name} al máximo de carriles · desviar ${Math.round(REDIRECT_FRAC * 100)}% a ${target.name}`,
            why: `Espera actual ${waits[g.id].toFixed(1)} min y pronóstico hasta ${Math.round(peak)} min; ya no hay carriles por abrir. ${target.name} está fluida (${waits[target.id].toFixed(1)} min).`,
            status: "pending",
            applied: false,
            effect: () => {
              fx.redirect[gid] = { to: target.id, frac: REDIRECT_FRAC };
              return [`Desvío activo: ${g.name} → ${target.name}`, `~${fans.toLocaleString("es-MX")} fans avisados por app y WhatsApp: usar ${target.name}`];
            },
          });
        }
        const a = actions[actions.length - 1];
        feed.push({ id: `act-${a.id}`, minute: m, area: a.area, kind: "accion", severity: statusFor(cfg, Math.max(waits[g.id], peak)), at: a.at, text: `${a.text} — ${a.why}`, actionId: a.id });
      }
      for (const b of cfg.bars) {
        const qm = bars[b.id].queueMin;
        const key = `bar-${b.id}`;
        if (qm === null || qm < cfg.barQueueAlert || openFor(key, m)) continue;
        const id = `${cfg.source}-bar-${b.id}-${m}`;
        const bid = b.id;
        actions.push({
          id,
          kind2: key,
          minute: m,
          area: "AYB",
          at: `bar:${b.id}`,
          bar: b.id,
          text: `${b.name} · abrir ${EXTRA_REGISTERS} cajas más`,
          why: `Fila de ${qm.toFixed(0)} min (umbral ${cfg.barQueueAlert} min). Cada minuto de fila es venta que no ocurre.`,
          status: "pending",
          applied: false,
          effect: () => {
            fx.extraRegisters[bid] = (fx.extraRegisters[bid] ?? 0) + EXTRA_REGISTERS;
            return [`${b.name}: ${EXTRA_REGISTERS} cajas más abiertas`];
          },
        });
        const a = actions[actions.length - 1];
        feed.push({ id: `act-${a.id}`, minute: m, area: "AYB", kind: "accion", severity: "warning", at: a.at, text: `${a.text} — ${a.why}`, actionId: a.id });
      }
      if (density !== null && density >= cfg.densityAlert && !fx.valve && !openFor("valve", m)) {
        const id = `${cfg.source}-valve-${m}`;
        const d = density;
        actions.push({
          id,
          kind2: "valve",
          minute: m,
          area: "SEG",
          at: "pista",
          text: "Pista frente al escenario · abrir válvula de alivio lateral",
          why: `Densidad de ${d.toFixed(1)} personas/m² (umbral ${cfg.densityAlert}).`,
          status: "pending",
          applied: false,
          effect: () => {
            fx.valve = true;
            return ["Válvula de alivio lateral abierta · staff en posición"];
          },
        });
        feed.push({ id: `act-${id}`, minute: m, area: "SEG", kind: "accion", severity: "critical", at: "pista", text: `Pista · ${d.toFixed(1)} p/m² → abrir válvula de alivio lateral`, actionId: id });
      }
    }

    // 6. Barra sin ventas mientras las demás venden (sólo con datos reales)
    if (cfg.source === "live" && m > 30) {
      const totalTx = cfg.bars.reduce((a, b) => a + bars[b.id].lastTx.reduce((x, y) => x + y, 0), 0);
      for (const b of cfg.bars) {
        const t = bars[b.id].lastTx;
        if (t.length === 10 && t.every((x) => x === 0) && totalTx > 50 && m - (noSalesFlag[b.id] ?? -999) > 30) {
          noSalesFlag[b.id] = m;
          feed.push({ id: `nosales-${b.id}-${m}`, minute: m, area: "AYB", kind: "alerta", severity: "warning", at: `bar:${b.id}`, text: `${b.name} sin ventas en 10 min mientras las demás venden: revisar terminal, inventario o personal` });
        }
      }
    }
    report.minutes = m + 1;
  }

  // ─── Vista actual ────────────────────────────────────────────────────────
  const lanes = lanesNow();
  const gates: GateView[] = cfg.gates.map((g) => {
    const wait = last >= 0 ? q[g.id] / (lanes[g.id] * rate) : 0;
    const fw = last >= 0 && hasData[g.id] ? forecastMax(g.id, last, lanes[g.id]) : 0;
    return {
      id: g.id,
      name: g.name,
      lanes: lanes[g.id],
      lanesMax: g.lanesMax,
      served: lastServed[g.id] ?? 0,
      arrivals: lastArr[g.id] ?? 0,
      queue: q[g.id],
      wait,
      status: statusFor(cfg, wait),
      forecastWait: fw,
      forecastStatus: statusFor(cfg, fw),
      queueSource: qSrc[g.id],
    };
  });
  const barViews: BarView[] = cfg.bars.map((b) => {
    const s = bars[b.id];
    return {
      id: b.id,
      name: b.name,
      registers: registersNow()[b.id],
      queueMin: s.queueMin,
      salesTotal: s.salesTotal,
      tx: s.tx,
      salesPerMin: s.lastSales.length ? s.lastSales.reduce((x, y) => x + y, 0) / s.lastSales.length : 0,
    };
  });
  const actionViews: Action[] = actions
    .map((a) => {
      const d = decide(a);
      return { id: a.id, minute: a.minute, area: a.area, text: a.text, why: a.why, at: a.at, status: d.status, decidedMinute: d.minute };
    })
    .sort((a, b) => b.minute - a.minute);
  const densityStatus: Status = density === null ? "good" : density >= cfg.densityAlert ? "critical" : density >= cfg.densityAlert * 0.8 ? "warning" : "good";
  const openAlerts =
    gates.filter((g) => g.status !== "good").length +
    barViews.filter((b) => (b.queueMin ?? 0) >= cfg.barQueueAlert).length +
    (densityStatus === "critical" ? 1 : 0);
  const phase: ConsoleState["phase"] = now < 0 ? "antes" : now < showMinute ? "ingreso" : now < showMinute + 30 ? "show" : "cierre";

  const state: ConsoleState = {
    generatedAt: input.now ?? Date.now(),
    source: cfg.source,
    running: input.running,
    speed: cfg.sim.speed,
    minute: input.minute,
    totalMinutes,
    showMinute,
    phase,
    clock: clockAt(cfg, now),
    event: { name: cfg.name, venue: cfg.venue, date: cfg.date, doorsOpen: cfg.doorsOpen, showStart: cfg.showStart, capacity: cfg.capacity, ticketsSold: cfg.ticketsSold },
    autopilot: cfg.autopilot,
    kpis: {
      inside: Math.round(inside),
      scansPerMin: Math.round(scansSeries[scansSeries.length - 1] ?? 0),
      inQueue: Math.round(Object.values(q).reduce((a, b) => a + b, 0)),
      openAlerts,
      actionsExecuted: actionViews.filter((a) => (a.status === "approved" || a.status === "auto") && (a.decidedMinute ?? Infinity) <= now).length,
      actionsPending: actionViews.filter((a) => a.status === "pending").length,
      salesTotal: Math.round(barViews.reduce((a, b) => a + b.salesTotal, 0)),
      salesPerMin: Math.round(barViews.reduce((a, b) => a + b.salesPerMin, 0)),
      density,
      densityStatus,
    },
    gates,
    bars: barViews,
    series: { scans: scansSeries, expected, inside: insideSeries },
    feed: feed.filter((e) => e.minute <= now).sort((a, b) => b.minute - a.minute || a.id.localeCompare(b.id)),
    actions: actionViews,
    storage: input.storage,
    ingestEnabled: input.ingestEnabled,
    copilotAI: input.copilotAI,
  };
  return { state, report };
}

function statusText(s: Status) {
  return s === "warning" ? "atención" : s === "serious" ? "saturada" : s === "critical" ? "crítica" : "fluida";
}
