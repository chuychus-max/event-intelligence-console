import { test } from "node:test";
import assert from "node:assert/strict";
import { compute } from "../src/lib/engine";
import { defaultConfig } from "../src/lib/defaults";
import { eventWindow } from "../src/lib/time";

const empty = { scans: {}, sales: {}, tx: {}, obs: {}, alerts: [] };

function run(minute: number, autopilot = true, decisions = {}) {
  const cfg = { ...defaultConfig(0), autopilot };
  return compute({ cfg, minute, running: true, data: empty, decisions, storage: "memoria", ingestEnabled: false, copilotAI: false }).state;
}

test("simulador: el evento completo llena el recinto y el copiloto actúa", () => {
  const cfg = defaultConfig(0);
  const s = run(eventWindow(cfg).totalMinutes - 1);
  assert.ok(s.kpis.inside > 50000, `dentro ${s.kpis.inside}`);
  const kinds = new Set(s.actions.map((a) => a.id.split("-")[1]));
  console.log(s.actions.map((a) => `${s.clock} ${a.minute} ${a.status} ${a.text}`).join("\n"));
  assert.ok(kinds.has("lanes"), "propone carriles");
  assert.ok(kinds.has("bar"), "propone cajas");
  assert.ok(kinds.has("valve"), "propone válvula");
  const worst = Math.max(...s.gates.map((g) => g.wait));
  console.log("peor espera al final", worst.toFixed(1), "ventas", s.kpis.salesTotal);
});

test("sin copiloto automático las acciones quedan pendientes y la fila es peor", () => {
  const cfg = defaultConfig(0);
  const S = eventWindow(cfg).showMinute;
  const auto = run(S - 10, true);
  const manual = run(S - 10, false);
  assert.ok(manual.kpis.actionsPending > 0);
  const c = (s: typeof auto) => s.gates.find((g) => g.id === "C")!.wait;
  console.log("C auto", c(auto).toFixed(1), "manual", c(manual).toFixed(1));
  assert.ok(c(manual) > c(auto));
});

test("datos reales: escaneos y sensor de fila", () => {
  const cfg = { ...defaultConfig(0), source: "live" as const };
  const data = { scans: { "10:A": 50, "11:A": 60 } as Record<string, number>, sales: {}, tx: {}, obs: { "queue:A:11": 400 } as Record<string, number>, alerts: [] };
  const s = compute({ cfg, minute: 11, running: true, data, decisions: {}, storage: "memoria", ingestEnabled: true, copilotAI: false }).state;
  const a = s.gates.find((g) => g.id === "A")!;
  assert.equal(a.queue, 400);
  assert.equal(a.queueSource, "sensor");
  assert.equal(s.kpis.inside, 110);
  assert.ok(Math.abs(a.wait - 400 / (9 * 8)) < 1e-9);
});

test("en vivo, una puerta sin datos no inventa fila ni acciones", () => {
  const cfg = { ...defaultConfig(0), source: "live" as const };
  const data = { scans: { "100:A": 60 } as Record<string, number>, sales: {}, tx: {}, obs: {}, alerts: [] };
  const s = compute({ cfg, minute: 200, running: true, data, decisions: {}, storage: "memoria", ingestEnabled: true, copilotAI: false }).state;
  const e = s.gates.find((g) => g.id === "E")!;
  assert.equal(e.queueSource, "sin datos");
  assert.equal(e.queue, 0);
  assert.equal(e.forecastWait, 0);
  assert.ok(!s.actions.some((a) => a.id.includes("lanes-E") || a.id.includes("redirect-E")));
});
