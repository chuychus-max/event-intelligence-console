import { toMin } from "./defaults";
import type { EventConfig } from "./types";

// El evento se mide en minutos desde la apertura de puertas (minuto 0).
// La ventana termina 30 min después del inicio del show.

export function eventWindow(cfg: EventConfig) {
  const doors = toMin(cfg.doorsOpen);
  const show = toMin(cfg.showStart);
  return { doors, showMinute: show - doors, totalMinutes: show - doors + 31 };
}

export function clockAt(cfg: EventConfig, minute: number) {
  const t = ((toMin(cfg.doorsOpen) + Math.round(minute)) % 1440 + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

// Minuto del evento para una marca de tiempo real, en la zona horaria del recinto.
export function minuteOf(cfg: EventConfig, ts: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: cfg.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ts));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const local = Number(get("hour")) * 60 + Number(get("minute"));
  const dayDiff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${cfg.date}T00:00:00Z`)) / 86400000);
  return dayDiff * 1440 + local - toMin(cfg.doorsOpen);
}

// Minuto actual: reloj real (en vivo) o reloj acelerado (simulador).
export function currentMinute(cfg: EventConfig, now = Date.now()): { minute: number; running: boolean } {
  const { totalMinutes } = eventWindow(cfg);
  if (cfg.source === "live") return { minute: minuteOf(cfg, now), running: true };
  const { startedAt, offset, speed } = cfg.sim;
  if (startedAt === null) return { minute: Math.min(totalMinutes - 1, offset), running: false };
  const m = offset + ((now - startedAt) / 60000) * speed;
  return m >= totalMinutes - 1 ? { minute: totalMinutes - 1, running: false } : { minute: m, running: true };
}
