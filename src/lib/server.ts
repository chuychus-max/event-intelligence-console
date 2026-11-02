import "server-only";
import { timingSafeEqual } from "node:crypto";
import { defaultConfig } from "./defaults";
import { compute } from "./engine";
import { getStore, type Store } from "./store";
import { currentMinute } from "./time";
import type { EventConfig } from "./types";

export async function loadConfig(store: Store): Promise<EventConfig> {
  const cfg = await store.getConfig();
  if (cfg) return cfg;
  const fresh = defaultConfig();
  await store.setConfig(fresh);
  return fresh;
}

// Carga todo y corre el motor hasta el minuto actual.
export async function snapshot(now = Date.now()) {
  const store = getStore();
  const cfg = await loadConfig(store);
  const [data, decisions] = await Promise.all([
    cfg.source === "live" ? store.getData() : Promise.resolve({ scans: {}, sales: {}, tx: {}, obs: {}, alerts: [] }),
    store.getDecisions(),
  ]);
  const { minute, running } = currentMinute(cfg, now);
  const out = compute({
    cfg,
    minute,
    running,
    data,
    decisions,
    storage: store.kind,
    ingestEnabled: Boolean(process.env.INGEST_API_KEY),
    copilotAI: Boolean(process.env.ANTHROPIC_API_KEY),
    now,
  });
  return { store, cfg, ...out };
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
