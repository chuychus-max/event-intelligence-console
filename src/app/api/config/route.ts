import { sanitizeConfig } from "@/lib/defaults";
import { json, loadConfig } from "@/lib/server";
import { getStore } from "@/lib/store";
import { currentMinute } from "@/lib/time";
import type { EventConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return json(await loadConfig(getStore()));
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as Partial<EventConfig> | null;
  if (!body || typeof body !== "object") return json({ error: "Cuerpo inválido" }, 400);
  const store = getStore();
  const prev = await loadConfig(store);
  const next = sanitizeConfig(body, prev);
  // Al cambiar de fuente, el simulador se congela donde iba.
  if (next.source !== prev.source) next.sim = { ...prev.sim, offset: Math.floor(currentMinute(prev).minute), startedAt: null };
  await store.setConfig(next);
  return json(next);
}
