// Almacenamiento del evento. Sin variables de entorno usa memoria del proceso
// (sirve para probar; en Vercel cada instancia tiene la suya y se borra al
// reiniciar). Con Upstash Redis (Vercel Marketplace) los datos son compartidos y
// persistentes: basta con KV_REST_API_URL/KV_REST_API_TOKEN o
// UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN.

import type { Decision, EventConfig, FeedEvent } from "./types";

export interface EventData {
  scans: Record<string, number>; // "minuto:puerta" → escaneos
  sales: Record<string, number>; // "minuto:barra" → pesos
  tx: Record<string, number>; // "minuto:barra" → transacciones
  obs: Record<string, number>; // "queue:A:minuto" | "barq:4:minuto" | "density:minuto" → valor
  alerts: FeedEvent[];
}

export interface Store {
  kind: "memoria" | "redis";
  getConfig(): Promise<EventConfig | null>;
  setConfig(c: EventConfig): Promise<void>;
  getData(): Promise<EventData>;
  addScans(items: { m: number; gate: string; n: number }[]): Promise<void>;
  addSales(items: { m: number; bar: string; amount: number; tx: number }[]): Promise<void>;
  setObs(items: { key: string; value: number }[]): Promise<void>;
  addAlert(a: FeedEvent): Promise<void>;
  getDecisions(): Promise<Record<string, Decision>>;
  setDecision(id: string, d: Decision): Promise<void>;
  clearDecisions(prefix: string): Promise<void>;
}

const P = "ei:";
const MAX_ALERTS = 500;

// ─── Memoria ────────────────────────────────────────────────────────────────

interface Mem {
  config: EventConfig | null;
  data: EventData;
  decisions: Record<string, Decision>;
}

function memory(): Store {
  const g = globalThis as unknown as { __eiMem?: Mem };
  g.__eiMem ??= { config: null, data: { scans: {}, sales: {}, tx: {}, obs: {}, alerts: [] }, decisions: {} };
  const s = g.__eiMem;
  return {
    kind: "memoria",
    async getConfig() {
      return s.config ? structuredClone(s.config) : null;
    },
    async setConfig(c) {
      s.config = structuredClone(c);
    },
    async getData() {
      return structuredClone(s.data);
    },
    async addScans(items) {
      for (const i of items) s.data.scans[`${i.m}:${i.gate}`] = (s.data.scans[`${i.m}:${i.gate}`] ?? 0) + i.n;
    },
    async addSales(items) {
      for (const i of items) {
        const k = `${i.m}:${i.bar}`;
        s.data.sales[k] = (s.data.sales[k] ?? 0) + i.amount;
        s.data.tx[k] = (s.data.tx[k] ?? 0) + i.tx;
      }
    },
    async setObs(items) {
      for (const i of items) s.data.obs[i.key] = i.value;
    },
    async addAlert(a) {
      s.data.alerts.unshift(a);
      s.data.alerts.length = Math.min(s.data.alerts.length, MAX_ALERTS);
    },
    async getDecisions() {
      return { ...s.decisions };
    },
    async setDecision(id, d) {
      s.decisions[id] = d;
    },
    async clearDecisions(prefix) {
      for (const k of Object.keys(s.decisions)) if (k.startsWith(prefix)) delete s.decisions[k];
    },
  };
}

// ─── Upstash Redis (REST) ───────────────────────────────────────────────────

function redis(url: string, token: string): Store {
  async function pipeline(cmds: (string | number)[][]): Promise<unknown[]> {
    if (cmds.length === 0) return [];
    const res = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(cmds),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Redis respondió ${res.status}`);
    const out = (await res.json()) as { result?: unknown; error?: string }[];
    const err = out.find((r) => r.error);
    if (err) throw new Error(`Redis: ${err.error}`);
    return out.map((r) => r.result);
  }
  const hash = (arr: unknown): Record<string, string> => {
    const o: Record<string, string> = {};
    if (Array.isArray(arr)) for (let i = 0; i + 1 < arr.length; i += 2) o[String(arr[i])] = String(arr[i + 1]);
    return o;
  };
  const nums = (h: Record<string, string>) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k, Number(v)]));

  return {
    kind: "redis",
    async getConfig() {
      const [v] = await pipeline([["GET", `${P}config`]]);
      return typeof v === "string" ? (JSON.parse(v) as EventConfig) : null;
    },
    async setConfig(c) {
      await pipeline([["SET", `${P}config`, JSON.stringify(c)]]);
    },
    async getData() {
      const [scans, sales, tx, obs, alerts] = await pipeline([
        ["HGETALL", `${P}scans`],
        ["HGETALL", `${P}sales`],
        ["HGETALL", `${P}tx`],
        ["HGETALL", `${P}obs`],
        ["LRANGE", `${P}alerts`, 0, MAX_ALERTS - 1],
      ]);
      return {
        scans: nums(hash(scans)),
        sales: nums(hash(sales)),
        tx: nums(hash(tx)),
        obs: nums(hash(obs)),
        alerts: Array.isArray(alerts) ? alerts.map((a) => JSON.parse(String(a)) as FeedEvent) : [],
      };
    },
    async addScans(items) {
      await pipeline(items.map((i) => ["HINCRBY", `${P}scans`, `${i.m}:${i.gate}`, Math.round(i.n)]));
    },
    async addSales(items) {
      await pipeline(
        items.flatMap((i) => [
          ["HINCRBYFLOAT", `${P}sales`, `${i.m}:${i.bar}`, i.amount],
          ["HINCRBY", `${P}tx`, `${i.m}:${i.bar}`, Math.round(i.tx)],
        ]),
      );
    },
    async setObs(items) {
      if (items.length) await pipeline([["HSET", `${P}obs`, ...items.flatMap((i) => [i.key, i.value])]]);
    },
    async addAlert(a) {
      await pipeline([
        ["LPUSH", `${P}alerts`, JSON.stringify(a)],
        ["LTRIM", `${P}alerts`, 0, MAX_ALERTS - 1],
      ]);
    },
    async getDecisions() {
      const [h] = await pipeline([["HGETALL", `${P}decisions`]]);
      return Object.fromEntries(Object.entries(hash(h)).map(([k, v]) => [k, JSON.parse(v) as Decision]));
    },
    async setDecision(id, d) {
      await pipeline([["HSET", `${P}decisions`, id, JSON.stringify(d)]]);
    },
    async clearDecisions(prefix) {
      const [h] = await pipeline([["HKEYS", `${P}decisions`]]);
      const keys = Array.isArray(h) ? h.map(String).filter((k) => k.startsWith(prefix)) : [];
      if (keys.length) await pipeline([["HDEL", `${P}decisions`, ...keys]]);
    },
  };
}

export function getStore(): Store {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? redis(url, token) : memory();
}
