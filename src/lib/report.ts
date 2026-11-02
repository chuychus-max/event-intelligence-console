import type { ReportData } from "./engine";
import { clockAt } from "./time";
import { AREA_LABEL, type ConsoleState, type EventConfig } from "./types";

// Reporte post-evento: lo que hoy se arma a mano al día siguiente.
export function buildReport(cfg: EventConfig, s: ConsoleState, r: ReportData) {
  // Espera que vivió cada persona: muestras ponderadas por quien pasó por la puerta.
  const samples = [...r.waitSamples].sort((a, b) => a[0] - b[0]);
  const people = samples.reduce((a, [, w]) => a + w, 0);
  const mean = people ? samples.reduce((a, [v, w]) => a + v * w, 0) / people : 0;
  let acc = 0;
  let p95 = 0;
  for (const [v, w] of samples) {
    acc += w;
    p95 = v;
    if (acc >= 0.95 * people) break;
  }
  const peakIdx = s.series.scans.reduce((best, v, i, arr) => (v > arr[best] ? i : best), 0);
  const personHours = r.queueTotal.reduce((a, b) => a + b, 0) / 60;
  const gates = cfg.gates.map((g) => {
    const w = r.waitsByGate[g.id];
    const max = w.length ? Math.max(...w) : 0;
    return {
      id: g.id,
      name: g.name,
      maxWait: max,
      maxAt: max >= 0.1 ? clockAt(cfg, w.indexOf(max)) : "—",
      minutesOverWarning: w.filter((x) => x >= cfg.thresholds.warning).length,
    };
  });
  const totalSales = s.bars.reduce((a, b) => a + b.salesTotal, 0);
  const totalTx = s.bars.reduce((a, b) => a + b.tx, 0);
  return {
    event: s.event,
    upTo: s.clock,
    minutes: r.minutes,
    attendance: s.kpis.inside,
    attendanceRate: s.event.ticketsSold ? s.kpis.inside / s.event.ticketsSold : 0,
    peak: { clock: clockAt(cfg, peakIdx), scansPerMin: Math.round(s.series.scans[peakIdx] ?? 0) },
    waits: { mean, p95 },
    personHoursInQueue: personHours,
    gates,
    sales: {
      total: totalSales,
      tx: totalTx,
      avgTicket: totalTx ? totalSales / totalTx : 0,
      perHead: s.kpis.inside ? totalSales / s.kpis.inside : 0,
      byBar: s.bars.map((b) => ({ name: b.name, total: b.salesTotal, tx: b.tx })),
    },
    actions: {
      total: s.actions.length,
      executed: s.actions.filter((a) => a.status === "approved" || a.status === "auto").length,
      dismissed: s.actions.filter((a) => a.status === "dismissed").length,
      pending: s.actions.filter((a) => a.status === "pending").length,
      list: s.actions.map((a) => ({ clock: clockAt(cfg, a.minute), area: AREA_LABEL[a.area], text: a.text, why: a.why, status: a.status })),
    },
    civilProtection: s.feed.filter((e) => e.area === "PC").map((e) => ({ clock: clockAt(cfg, e.minute), text: e.text })).reverse(),
    log: s.feed.map((e) => ({ clock: clockAt(cfg, e.minute), area: AREA_LABEL[e.area], kind: e.kind, text: e.text })).reverse(),
  };
}

export type Report = ReturnType<typeof buildReport>;

export function reportCsv(rep: Report) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = [["hora", "area", "tipo", "texto"], ...rep.log.map((l) => [l.clock, l.area, l.kind, l.text])];
  return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\n");
}
