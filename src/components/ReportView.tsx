"use client";

import { useEffect, useState } from "react";
import { Download, Printer, RefreshCw } from "lucide-react";
import type { Report } from "@/lib/report";
import { fmt, money } from "./ui";

const STATUS_TEXT: Record<string, string> = { approved: "Aprobada", auto: "Automática", dismissed: "Descartada", pending: "Pendiente" };

export function ReportView() {
  const [rep, setRep] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    try {
      const res = await fetch("/api/report", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setRep(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    load();
  }, []);

  if (!rep) return <main className="mx-auto max-w-5xl px-4 py-16 text-sm text-ink-2">{error ?? "Armando el reporte…"}</main>;
  const maxBar = Math.max(1, ...rep.sales.byBar.map((b) => b.total));

  return (
    <main className="mx-auto max-w-5xl px-3 pb-16 pt-6 sm:px-4">
      <div className="sheet px-5 py-8 sm:px-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="tracked-sm text-[10px] text-muted">
              Reporte post-evento · {rep.event.date} · corte {rep.upTo}
            </p>
            <h1 className="tracked mt-2 text-xl">{rep.event.name}</h1>
            <p className="mt-1 text-sm text-ink-2">{rep.event.venue}</p>
          </div>
          <div className="flex gap-2 print:hidden">
            <button type="button" onClick={load} className="flex items-center gap-1.5 border border-ink px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] hover:bg-surface-2">
              <RefreshCw className="h-3.5 w-3.5" /> Actualizar
            </button>
            <a href="/api/report?format=csv" className="flex items-center gap-1.5 border border-ink px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] hover:bg-surface-2">
              <Download className="h-3.5 w-3.5" /> Bitácora CSV
            </a>
            <button type="button" onClick={() => window.print()} className="flex items-center gap-1.5 bg-ink px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-surface">
              <Printer className="h-3.5 w-3.5" /> Imprimir / PDF
            </button>
          </div>
        </div>

        <dl className="mt-8 grid grid-cols-2 gap-px border border-line bg-[var(--border)] sm:grid-cols-4">
          {[
            ["Asistencia", fmt(rep.attendance), `${(rep.attendanceRate * 100).toFixed(1)}% de los boletos`],
            ["Pico de ingreso", rep.peak.clock, `${fmt(rep.peak.scansPerMin)} escaneos/min`],
            ["Espera promedio", `${rep.waits.mean.toFixed(1)} min`, `p95: ${rep.waits.p95.toFixed(1)} min`],
            ["Horas-persona en fila", fmt(rep.personHoursInQueue), "tiempo que pudo ser consumo"],
            ["Ventas en barras", money(rep.sales.total), `${fmt(rep.sales.tx)} transacciones`],
            ["Ticket promedio", money(rep.sales.avgTicket), "por transacción"],
            ["Gasto por asistente", money(rep.sales.perHead), "sólo barras"],
            ["Acciones del copiloto", String(rep.actions.executed), `${rep.actions.dismissed} descartadas · ${rep.actions.pending} pendientes`],
          ].map(([k, v, d]) => (
            <div key={k} className="bg-surface p-4">
              <dt className="text-[10px] uppercase tracking-[0.14em] text-muted">{k}</dt>
              <dd className="tabular display mt-1 text-xl font-bold">{v}</dd>
              <dd className="mt-1 text-[11px] text-ink-2">{d}</dd>
            </div>
          ))}
        </dl>

        <section className="mt-10 grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="tracked-sm text-[11px] text-muted">Accesos</h2>
            <table className="mt-3 w-full text-[12px]">
              <thead>
                <tr className="border-b border-ink text-left text-[10px] uppercase tracking-[0.12em] text-muted">
                  <th className="py-1.5 font-normal">Puerta</th>
                  <th className="py-1.5 text-right font-normal">Peor espera</th>
                  <th className="py-1.5 text-right font-normal">A las</th>
                  <th className="py-1.5 text-right font-normal">Min. en atención</th>
                </tr>
              </thead>
              <tbody>
                {rep.gates.map((g) => (
                  <tr key={g.id} className="border-b border-line">
                    <td className="py-1.5">{g.name}</td>
                    <td className="tabular py-1.5 text-right">{g.maxWait.toFixed(1)} min</td>
                    <td className="tabular py-1.5 text-right">{g.maxAt}</td>
                    <td className="tabular py-1.5 text-right">{g.minutesOverWarning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h2 className="tracked-sm text-[11px] text-muted">Ventas por barra</h2>
            <ul className="mt-3 space-y-2">
              {rep.sales.byBar.map((b) => (
                <li key={b.name}>
                  <div className="flex justify-between text-[12px]">
                    <span>{b.name}</span>
                    <span className="tabular">{money(b.total)}</span>
                  </div>
                  <div className="mt-1 h-2 bg-[var(--seq-1)]">
                    <div className="h-full bg-ink" style={{ width: `${(b.total / maxBar) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="tracked-sm text-[11px] text-muted">Acciones del copiloto</h2>
          {rep.actions.list.length === 0 ? (
            <p className="mt-3 text-sm text-ink-2">Ninguna en este corte.</p>
          ) : (
            <ol className="mt-3 border-t border-ink">
              {rep.actions.list.map((a, i) => (
                <li key={i} className="grid gap-1 border-b border-line py-2 text-[12px] sm:grid-cols-[4rem_1fr_7rem]">
                  <span className="tabular text-muted">{a.clock}</span>
                  <span>
                    <span className="font-semibold">{a.text}</span> <span className="text-ink-2">— {a.why}</span>
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.12em] sm:text-right">{STATUS_TEXT[a.status]}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="mt-10">
          <h2 className="tracked-sm text-[11px] text-muted">Bitácora de Protección Civil</h2>
          <ol className="mt-3 border-t border-ink">
            {rep.civilProtection.map((e, i) => (
              <li key={i} className="flex gap-4 border-b border-line py-2 text-[12px]">
                <span className="tabular text-muted">{e.clock}</span>
                <span>{e.text}</span>
              </li>
            ))}
            {rep.civilProtection.length === 0 && <li className="py-2 text-sm text-ink-2">Sin registros.</li>}
          </ol>
        </section>

        <p className="mt-10 text-[11px] text-muted">
          La bitácora completa ({fmt(rep.log.length)} registros) se descarga en CSV. Las esperas se calculan con sensor de fila cuando existe, o se estiman con llegadas esperadas menos escaneos.
        </p>
      </div>
    </main>
  );
}
