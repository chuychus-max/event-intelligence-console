import { json, loadConfig } from "@/lib/server";
import { getStore } from "@/lib/store";
import { currentMinute, eventWindow } from "@/lib/time";

export const dynamic = "force-dynamic";

// Controles del simulador: reproducir, pausar, velocidad, saltar y reiniciar.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { op?: string; speed?: number; minute?: number } | null;
  const store = getStore();
  const cfg = await loadConfig(store);
  if (cfg.source !== "sim") return json({ error: "El simulador sólo funciona con la fuente 'sim'" }, 409);
  const now = Date.now();
  const cur = currentMinute(cfg, now).minute;
  const { totalMinutes } = eventWindow(cfg);
  switch (body?.op) {
    case "play":
      cfg.sim = { ...cfg.sim, offset: cur >= totalMinutes - 1 ? 0 : cur, startedAt: now };
      break;
    case "pause":
      cfg.sim = { ...cfg.sim, offset: cur, startedAt: null };
      break;
    case "speed": {
      const sp = Number(body.speed);
      if (!Number.isFinite(sp) || sp < 1 || sp > 120) return json({ error: "Velocidad entre 1 y 120" }, 400);
      cfg.sim = { ...cfg.sim, speed: sp, offset: cur, startedAt: cfg.sim.startedAt === null ? null : now };
      break;
    }
    case "seek": {
      const m = Number(body.minute);
      if (!Number.isFinite(m)) return json({ error: "Minuto inválido" }, 400);
      cfg.sim = { ...cfg.sim, offset: Math.max(0, Math.min(totalMinutes - 1, m)), startedAt: cfg.sim.startedAt === null ? null : now };
      break;
    }
    case "reset":
      // Sólo las decisiones del simulador: los datos reales recibidos no se tocan.
      await store.clearDecisions("sim-");
      cfg.sim = { ...cfg.sim, offset: 0, startedAt: now };
      break;
    default:
      return json({ error: "op: play | pause | speed | seek | reset" }, 400);
  }
  await store.setConfig(cfg);
  return json({ ok: true, sim: cfg.sim });
}
